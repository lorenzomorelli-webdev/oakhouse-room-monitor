import {
  FX_SCHEMA_VERSION,
  type FxSnapshot,
} from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ));
  return date.toISOString().slice(0, 10) === value;
}

function invalidResponse(): never {
  throw new Error("Invalid Twelve Data response");
}

export function parseFxQuote(
  value: unknown,
  sourceUrl: string,
  checkedAt: string,
): FxSnapshot {
  if (
    !isRecord(value) ||
    value.symbol !== "EUR/JPY" ||
    !isCalendarDate(value.datetime) ||
    !isRecord(value.fifty_two_week)
  ) {
    return invalidResponse();
  }

  const dayOpen = parseFiniteNumber(value.open);
  const dayHigh = parseFiniteNumber(value.high);
  const dayLow = parseFiniteNumber(value.low);
  const rate = parseFiniteNumber(value.close);
  const previousClose = parseFiniteNumber(value.previous_close);
  const yearLow = parseFiniteNumber(value.fifty_two_week.low);
  const yearHigh = parseFiniteNumber(value.fifty_two_week.high);

  if (
    dayOpen === null ||
    dayHigh === null ||
    dayLow === null ||
    rate === null ||
    previousClose === null ||
    yearLow === null ||
    yearHigh === null ||
    dayHigh < Math.max(dayOpen, rate) ||
    dayLow > Math.min(dayOpen, rate) ||
    dayLow > dayHigh ||
    yearLow > dayLow ||
    yearHigh < dayHigh
  ) {
    return invalidResponse();
  }

  return {
    schemaVersion: FX_SCHEMA_VERSION,
    sourceUrl,
    checkedAt,
    symbol: "EUR/JPY",
    marketDate: value.datetime,
    rate,
    dayOpen,
    dayHigh,
    dayLow,
    previousClose,
    yearLow,
    yearHigh,
  };
}
