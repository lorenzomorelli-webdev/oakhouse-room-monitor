import { describe, expect, it } from "vitest";
import { parseOakhouseHtml } from "../src/parser";
import { parseHealthState, parseSnapshotState } from "../src/state";
import { BASELINE_HTML } from "./fixtures/oakhouse";

const URL = "https://www.oakhouse.jp/eng/house/1142";
const NOW = "2026-08-17T17:00:00.000Z";

describe("persisted state validation", () => {
  it("accepts a valid snapshot and health state", async () => {
    const snapshot = await parseOakhouseHtml(BASELINE_HTML, URL, NOW);

    expect(parseSnapshotState(snapshot)).toEqual(snapshot);
    expect(parseHealthState({
      consecutiveFailures: 3,
      lastSuccessAt: NOW,
      lastErrorAt: NOW,
      lastError: "HTTP 503",
      outageDetected: true,
      alertSent: true,
    })).toMatchObject({
      consecutiveFailures: 3,
      outageDetected: true,
      alertSent: true,
    });
  });

  it("rejects an unsupported snapshot schema", async () => {
    const snapshot = await parseOakhouseHtml(BASELINE_HTML, URL, NOW);

    expect(() => parseSnapshotState({
      ...snapshot,
      schemaVersion: 99,
    })).toThrow("Invalid persisted snapshot");
  });

  it("rejects inconsistent room counts and references", async () => {
    const snapshot = await parseOakhouseHtml(BASELINE_HTML, URL, NOW);

    expect(() => parseSnapshotState({
      ...snapshot,
      parsedRoomCount: 999,
    })).toThrow("Invalid persisted snapshot");
    expect(() => parseSnapshotState({
      ...snapshot,
      availableRoomIds: [...snapshot.availableRoomIds, "missing"],
      availableRoomCount: snapshot.availableRoomCount + 1,
    })).toThrow("Invalid persisted snapshot");
  });

  it("rejects malformed health state", () => {
    expect(() => parseHealthState({
      consecutiveFailures: -1,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      outageDetected: false,
      alertSent: false,
    })).toThrow("Invalid persisted health state");
    expect(() => parseHealthState({
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      outageDetected: false,
      alertSent: "yes",
    })).toThrow("Invalid persisted health state");
  });
});
