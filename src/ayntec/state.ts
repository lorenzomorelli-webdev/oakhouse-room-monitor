import {
  AYNTEC_SCHEMA_VERSION,
  type AyntecSnapshot,
  type ShipmentEntry,
} from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function invalidSnapshot(): never {
  throw new Error("Invalid persisted AYN snapshot");
}

export function parseAyntecSnapshotState(value: unknown): AyntecSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== AYNTEC_SCHEMA_VERSION ||
    !isNonEmptyString(value.sourceUrl) ||
    !isIsoTimestamp(value.checkedAt) ||
    !isRecord(value.entries) ||
    !Number.isInteger(value.entryCount) ||
    Number(value.entryCount) <= 0 ||
    !isNonEmptyString(value.latestDate) ||
    Object.keys(value.entries).length !== value.entryCount
  ) {
    return invalidSnapshot();
  }
  const dates: string[] = [];
  const entries: Record<string, ShipmentEntry> = {};
  for (const [key, entry] of Object.entries(value.entries)) {
    if (
      !isRecord(entry) ||
      entry.id !== key ||
      !isCalendarDate(entry.date) ||
      !isNonEmptyString(entry.product) ||
      !isNonEmptyString(entry.details)
    ) {
      return invalidSnapshot();
    }
    const expectedKey = entry.date + "|" +
      entry.product.normalize("NFKC").toLocaleLowerCase("en-US");
    if (key !== expectedKey) {
      return invalidSnapshot();
    }
    dates.push(entry.date);
    entries[key] = {
      id: key,
      date: entry.date,
      product: entry.product,
      details: entry.details,
    };
  }
  if (dates.sort().at(-1) !== value.latestDate) {
    return invalidSnapshot();
  }
  return {
    schemaVersion: AYNTEC_SCHEMA_VERSION,
    sourceUrl: value.sourceUrl,
    checkedAt: value.checkedAt,
    entryCount: Number(value.entryCount),
    latestDate: value.latestDate,
    entries,
  };
}
