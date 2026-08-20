import { describe, expect, it } from "vitest";
import { parseFxTimeSeries } from "../src/fx/parser";
import { TWELVE_DATA_EUR_JPY_RESPONSE } from "./fixtures/fx";

const SOURCE_URL = "https://api.twelvedata.com/time_series";
const CHECKED_AT = "2026-08-20T14:00:00.000Z";

describe("parseFxTimeSeries", () => {
  it("normalizes a descending EUR/JPY series into a validated snapshot", () => {
    const snapshot = parseFxTimeSeries(
      TWELVE_DATA_EUR_JPY_RESPONSE,
      SOURCE_URL,
      CHECKED_AT,
    );

    expect(snapshot).toEqual({
      schemaVersion: 1,
      sourceUrl: SOURCE_URL,
      checkedAt: CHECKED_AT,
      symbol: "EUR/JPY",
      marketDate: "2026-08-20",
      rate: 185.4255,
      dayOpen: 184.6385,
      dayHigh: 185.78,
      dayLow: 184.502,
      previousClose: 184.6385,
      history: [
        { date: "2025-08-21", close: 172.11, high: 172.44, low: 170.918 },
        { date: "2025-11-20", close: 178.86, high: 179.12, low: 177.95 },
        { date: "2026-05-20", close: 186.81, high: 187.568, low: 185.44 },
        { date: "2026-08-19", close: 184.6385, high: 184.91, low: 183.74 },
        { date: "2026-08-20", close: 185.4255, high: 185.78, low: 184.502 },
      ],
    });
  });

  it("falls back to the prior candle when previous_close is omitted", () => {
    const payload = structuredClone(TWELVE_DATA_EUR_JPY_RESPONSE) as {
      values: Array<Record<string, string>>;
    };
    delete payload.values[0].previous_close;

    expect(
      parseFxTimeSeries(payload, SOURCE_URL, CHECKED_AT).previousClose,
    ).toBe(184.6385);
  });

  it("keeps only the trailing calendar year even when extra candles are returned", () => {
    const payload = structuredClone(TWELVE_DATA_EUR_JPY_RESPONSE) as {
      values: Array<Record<string, string>>;
    };
    payload.values.push({
      datetime: "2025-08-19",
      open: "160.00000",
      high: "161.00000",
      low: "159.00000",
      close: "160.00000",
      previous_close: "159.50000",
    });

    const snapshot = parseFxTimeSeries(payload, SOURCE_URL, CHECKED_AT);

    expect(snapshot.history[0].date).toBe("2025-08-21");
    expect(snapshot.history).not.toContainEqual({
      date: "2025-08-19",
      close: 160,
      high: 161,
      low: 159,
    });
  });

  it.each([
    { ...TWELVE_DATA_EUR_JPY_RESPONSE, status: "error", message: "bad key" },
    { ...TWELVE_DATA_EUR_JPY_RESPONSE, values: [] },
    {
      ...TWELVE_DATA_EUR_JPY_RESPONSE,
      values: [
        { ...TWELVE_DATA_EUR_JPY_RESPONSE.values[0], close: "not-a-rate" },
        ...TWELVE_DATA_EUR_JPY_RESPONSE.values.slice(1),
      ],
    },
  ])("rejects an invalid provider payload", (payload) => {
    expect(() => parseFxTimeSeries(payload, SOURCE_URL, CHECKED_AT)).toThrow(
      "Invalid Twelve Data response",
    );
  });
});
