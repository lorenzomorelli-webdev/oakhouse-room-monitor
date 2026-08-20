import { describe, expect, it } from "vitest";
import { getFxMetrics, type FxSnapshot } from "../src/fx/model";

const snapshot: FxSnapshot = {
  schemaVersion: 1,
  sourceUrl: "https://api.twelvedata.com/time_series",
  checkedAt: "2026-08-20T14:00:00.000Z",
  symbol: "EUR/JPY",
  marketDate: "2026-08-20",
  rate: 185.4255,
  dayOpen: 184.6385,
  dayHigh: 185.78,
  dayLow: 184.502,
  previousClose: 184.6385,
  history: [
    { date: "2025-08-21", close: 172.11, high: 172.44, low: 170.918 },
    { date: "2026-05-20", close: 186.81, high: 187.568, low: 185.44 },
    { date: "2026-08-20", close: 185.4255, high: 185.78, low: 184.502 },
  ],
};

describe("getFxMetrics", () => {
  it("derives daily and yearly performance from literal market values", () => {
    const metrics = getFxMetrics(snapshot);

    expect(metrics.dayChange).toBeCloseTo(0.787, 10);
    expect(metrics.dayChangePercent).toBeCloseTo(0.4262382981, 10);
    expect(metrics.yearLow).toBe(170.918);
    expect(metrics.yearHigh).toBe(187.568);
    expect(metrics.yearChange).toBeCloseTo(13.3155, 10);
    expect(metrics.yearChangePercent).toBeCloseTo(7.7366219278, 10);
  });
});
