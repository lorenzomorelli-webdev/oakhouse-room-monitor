import {
  FX_SCHEMA_VERSION,
  type FxDailyPoint,
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
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function invalidResponse(): never {
  throw new Error("Invalid Twelve Data response");
}

export function parseFxTimeSeries(
  value: unknown,
  sourceUrl: string,
  checkedAt: string,
): FxSnapshot {
  if (
    !isRecord(value) ||
    value.status !== "ok" ||
    !isRecord(value.meta) ||
    value.meta.symbol !== "EUR/JPY" ||
    !Array.isArray(value.values) ||
    value.values.length < 2
  ) {
    return invalidResponse();
  }

  const parsedRows = value.values.map((row) => {
    if (!isRecord(row) || !isCalendarDate(row.datetime)) {
      return invalidResponse();
    }
    const open = parseFiniteNumber(row.open);
    const high = parseFiniteNumber(row.high);
    const low = parseFiniteNumber(row.low);
    const close = parseFiniteNumber(row.close);
    if (
      open === null || high === null || low === null || close === null ||
      high < Math.max(open, close) || low > Math.min(open, close) || low > high
    ) {
      return invalidResponse();
    }
    return { date: row.datetime, open, high, low, close, previousClose: parseFiniteNumber(row.previous_close) };
  });

  parsedRows.sort((left, right) => left.date.localeCompare(right.date));
  for (let index = 1; index < parsedRows.length; index += 1) {
    if (parsedRows[index - 1].date === parsedRows[index].date) {
      return invalidResponse();
    }
  }

  const latest = parsedRows.at(-1);
  const prior = parsedRows.at(-2);
  if (!latest || !prior) {
    return invalidResponse();
  }
  const previousClose = latest.previousClose ?? prior.close;
  const cutoff = new Date(latest.date + "T00:00:00.000Z");
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const history: FxDailyPoint[] = parsedRows
    .filter(({ date }) => date >= cutoffDate)
    .map(({ date, close, high, low }) => ({ date, close, high, low }));

  return {
    schemaVersion: FX_SCHEMA_VERSION,
    sourceUrl,
    checkedAt,
    symbol: "EUR/JPY",
    marketDate: latest.date,
    rate: latest.close,
    dayOpen: latest.open,
    dayHigh: latest.high,
    dayLow: latest.low,
    previousClose,
    history,
  };
}
