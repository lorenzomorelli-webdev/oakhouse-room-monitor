import {
  FX_SCHEMA_VERSION,
  type FxDailyPoint,
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
    value.dayHigh < Math.max(value.dayOpen, value.rate) ||
    value.dayLow > Math.min(value.dayOpen, value.rate) ||
    value.dayLow > value.dayHigh ||
    !Array.isArray(value.history) ||
    value.history.length < 2
  ) {
    return invalidSnapshot();
  }

  const history: FxDailyPoint[] = [];
  let previousDate = "";
  for (const point of value.history) {
    if (
      !isRecord(point) ||
      !isCalendarDate(point.date) ||
      !isPositiveNumber(point.close) ||
      !isPositiveNumber(point.high) ||
      !isPositiveNumber(point.low) ||
      point.high < point.close ||
      point.low > point.close ||
      point.low > point.high ||
      point.date <= previousDate
    ) {
      return invalidSnapshot();
    }
    previousDate = point.date;
    history.push({
      date: point.date,
      close: point.close,
      high: point.high,
      low: point.low,
    });
  }
  if (
    history.at(-1)?.date !== value.marketDate ||
    history.at(-1)?.close !== value.rate ||
    history.at(-1)?.high !== value.dayHigh ||
    history.at(-1)?.low !== value.dayLow
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
    history,
  };
}
