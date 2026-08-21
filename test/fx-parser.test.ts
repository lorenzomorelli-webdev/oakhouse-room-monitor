import { describe, expect, it } from "vitest";
import { parseFxQuote } from "../src/fx/parser";
import { TWELVE_DATA_EUR_JPY_RESPONSE } from "./fixtures/fx";

const SOURCE_URL = "https://api.twelvedata.com/quote";
const CHECKED_AT = "2026-08-20T14:00:00.000Z";

describe("parseFxQuote", () => {
  it("normalizes a lightweight EUR/JPY quote into a validated snapshot", () => {
    const snapshot = parseFxQuote(
      TWELVE_DATA_EUR_JPY_RESPONSE,
      SOURCE_URL,
      CHECKED_AT,
    );

    expect(snapshot).toEqual({
      schemaVersion: 2,
      sourceUrl: SOURCE_URL,
      checkedAt: CHECKED_AT,
      symbol: "EUR/JPY",
      marketDate: "2026-08-20",
      rate: 185.4255,
      dayOpen: 184.6385,
      dayHigh: 185.78,
      dayLow: 184.502,
      previousClose: 184.6385,
      yearLow: 170.918,
      yearHigh: 187.568,
    });
  });

  it.each([
    { ...TWELVE_DATA_EUR_JPY_RESPONSE, symbol: "USD/JPY" },
    { ...TWELVE_DATA_EUR_JPY_RESPONSE, previous_close: null },
    {
      ...TWELVE_DATA_EUR_JPY_RESPONSE,
      fifty_two_week: { low: "190", high: "170" },
    },
  ])("rejects an invalid provider payload", (payload) => {
    expect(() => parseFxQuote(payload, SOURCE_URL, CHECKED_AT)).toThrow(
      "Invalid Twelve Data response",
    );
  });
});
