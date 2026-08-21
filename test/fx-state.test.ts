import { describe, expect, it } from "vitest";
import type { FxSnapshot } from "../src/fx/model";
import { parseFxSnapshotState } from "../src/fx/state";

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

describe("parseFxSnapshotState", () => {
  it("returns a normalized copy of a valid persisted snapshot", () => {
    expect(parseFxSnapshotState(structuredClone(snapshot))).toEqual(snapshot);
  });

  it.each([
    { ...snapshot, schemaVersion: 1 },
    { ...snapshot, rate: Number.NaN },
    { ...snapshot, dayHigh: 180 },
    { ...snapshot, yearLow: 190 },
    { ...snapshot, yearHigh: 180 },
  ])("rejects inconsistent persisted state", (value) => {
    expect(() => parseFxSnapshotState(value)).toThrow(
      "Invalid persisted FX snapshot",
    );
  });
});
