import { describe, expect, it } from "vitest";
import type { FxSnapshot } from "../src/fx/model";
import { parseFxSnapshotState } from "../src/fx/state";

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
    { date: "2026-08-20", close: 185.4255, high: 185.78, low: 184.502 },
  ],
};

describe("parseFxSnapshotState", () => {
  it("returns a normalized copy of a valid persisted snapshot", () => {
    expect(parseFxSnapshotState(structuredClone(snapshot))).toEqual(snapshot);
  });

  it.each([
    { ...snapshot, schemaVersion: 2 },
    { ...snapshot, rate: Number.NaN },
    { ...snapshot, dayHigh: 180 },
    { ...snapshot, marketDate: "2026-08-19" },
    { ...snapshot, history: [...snapshot.history].reverse() },
    {
      ...snapshot,
      history: [
        { ...snapshot.history[0], high: 170 },
        snapshot.history[1],
      ],
    },
  ])("rejects inconsistent persisted state", (value) => {
    expect(() => parseFxSnapshotState(value)).toThrow(
      "Invalid persisted FX snapshot",
    );
  });
});
