import { describe, expect, it } from "vitest";
import { getFxMetrics, type FxSnapshot } from "../src/fx/model";

const snapshot: FxSnapshot = {
  schemaVersion: 2,
  sourceUrl: "https://api.twelvedata.com/quote",
  checkedAt: "2026-08-20T14:00:00.000Z",
  symbol: "EUR/JPY",
  marketDate: "2026-08-20",
  rate: 185.4255,
  dayOpen: 184.6385,
  dayHigh: 185.78,
  dayLow: 184.502,
  previousClose: 184.6385,
  yearLow: 170.918,
  yearHigh: 187.568,
};

describe("getFxMetrics", () => {
  it("derives daily performance and distance from the yearly high", () => {
    const metrics = getFxMetrics(snapshot);

    expect(metrics.dayChange).toBeCloseTo(0.787, 10);
    expect(metrics.dayChangePercent).toBeCloseTo(0.4262382981, 10);
    expect(metrics.yearLow).toBe(170.918);
    expect(metrics.yearHigh).toBe(187.568);
    expect(metrics.yearHighDistancePercent).toBeCloseTo(-1.1422524098, 10);
  });
});
