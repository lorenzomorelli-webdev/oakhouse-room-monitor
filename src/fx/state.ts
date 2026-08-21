import {
  FX_SCHEMA_VERSION,
  type FxSnapshot,
} from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) === value;
}

function invalidSnapshot(): never {
  throw new Error("Invalid persisted FX snapshot");
}

export function parseFxSnapshotState(value: unknown): FxSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== FX_SCHEMA_VERSION ||
    !isNonEmptyString(value.sourceUrl) ||
    !isIsoTimestamp(value.checkedAt) ||
    value.symbol !== "EUR/JPY" ||
    !isCalendarDate(value.marketDate) ||
    !isPositiveNumber(value.rate) ||
    !isPositiveNumber(value.dayOpen) ||
    !isPositiveNumber(value.dayHigh) ||
    !isPositiveNumber(value.dayLow) ||
    !isPositiveNumber(value.previousClose) ||
    !isPositiveNumber(value.yearLow) ||
    !isPositiveNumber(value.yearHigh) ||
    value.dayHigh < Math.max(value.dayOpen, value.rate) ||
    value.dayLow > Math.min(value.dayOpen, value.rate) ||
    value.dayLow > value.dayHigh ||
    value.yearLow > value.dayLow ||
    value.yearHigh < value.dayHigh
  ) {
    return invalidSnapshot();
  }

  return {
    schemaVersion: FX_SCHEMA_VERSION,
    sourceUrl: value.sourceUrl,
    checkedAt: value.checkedAt,
    symbol: "EUR/JPY",
    marketDate: value.marketDate,
    rate: value.rate,
    dayOpen: value.dayOpen,
    dayHigh: value.dayHigh,
    dayLow: value.dayLow,
    previousClose: value.previousClose,
    yearLow: value.yearLow,
    yearHigh: value.yearHigh,
  };
}
