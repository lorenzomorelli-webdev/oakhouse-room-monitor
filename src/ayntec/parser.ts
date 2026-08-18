import { normalizeText } from "../model";
import {
  AYNTEC_SCHEMA_VERSION,
  type AyntecSnapshot,
  type ShipmentEntry,
} from "./model";

interface Paragraph {
  text: string;
  hasStrongText: boolean;
}

export class AyntecParseError extends Error {
  override name = "AyntecParseError";
}

class ParagraphCollector {
  readonly paragraphs: Paragraph[] = [];
  private current: Paragraph | null = null;

  start(element: Element): void {
    this.current = { text: "", hasStrongText: false };
    element.onEndTag(() => {
      if (this.current) {
        this.paragraphs.push(this.current);
        this.current = null;
      }
    });
  }

  markStrongText(): void {
    if (this.current) {
      this.current.hasStrongText = true;
    }
  }

  append(text: string): void {
    if (this.current) {
      this.current.text += text;
    }
  }
}

class ParagraphHandler implements HTMLRewriterElementContentHandlers {
  constructor(private readonly collector: ParagraphCollector) {}

  element(element: Element): void {
    this.collector.start(element);
  }

  text(text: Text): void {
    this.collector.append(text.text);
  }
}

class StrongHandler implements HTMLRewriterElementContentHandlers {
  constructor(private readonly collector: ParagraphCollector) {}

  element(): void {
    this.collector.markStrongText();
  }
}

function canonicalDate(value: string): string | null {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new AyntecParseError("Invalid AYN shipment date: " + value);
  }
  return [
    match[1],
    match[2].padStart(2, "0"),
    match[3].padStart(2, "0"),
  ].join("-");
}

function normalizeParagraphText(value: string): string {
  return normalizeText(value.replace(/&nbsp;/gi, " ")).normalize("NFKC");
}

function parseEntry(date: string, value: string): ShipmentEntry | null {
  const separator = value.search(/[:：]/);
  if (separator < 1) {
    return null;
  }
  const product = normalizeText(value.slice(0, separator)).normalize("NFKC");
  const details = normalizeText(value.slice(separator + 1)).normalize("NFKC");
  if (!product || !details) {
    return null;
  }
  const id = date + "|" + product.toLocaleLowerCase("en-US");
  return { id, date, product, details };
}

export async function parseAyntecHtml(
  html: string,
  sourceUrl: string,
  checkedAt: string,
): Promise<AyntecSnapshot> {
  const collector = new ParagraphCollector();
  const rewriter = new HTMLRewriter()
    .on(".rte p", new ParagraphHandler(collector))
    .on(".rte p strong", new StrongHandler(collector));
  await rewriter
    .transform(new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }))
    .text();

  let currentDate: string | null = null;
  const entries: Record<string, ShipmentEntry> = {};
  for (const paragraph of collector.paragraphs) {
    const text = normalizeParagraphText(paragraph.text);
    const date = paragraph.hasStrongText ? canonicalDate(text) : null;
    if (date) {
      currentDate = date;
      continue;
    }
    if (!currentDate || !text) {
      continue;
    }
    const entry = parseEntry(currentDate, text);
    if (!entry) {
      throw new AyntecParseError("Malformed AYN shipment row: " + text);
    }
    if (entries[entry.id]) {
      throw new AyntecParseError(
        "Duplicate AYN shipment entry: " + entry.id,
      );
    }
    entries[entry.id] = entry;
  }

  const dates = Object.values(entries).map((entry) => entry.date).sort();
  if (dates.length === 0) {
    throw new AyntecParseError("No AYN shipment entries found");
  }
  return {
    schemaVersion: AYNTEC_SCHEMA_VERSION,
    sourceUrl,
    checkedAt,
    entryCount: dates.length,
    latestDate: dates.at(-1)!,
    entries,
  };
}
