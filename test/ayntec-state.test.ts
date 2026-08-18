import { describe, expect, it } from "vitest";
import { parseAyntecHtml } from "../src/ayntec/parser";
import { parseAyntecSnapshotState } from "../src/ayntec/state";
import { AYNTEC_DASHBOARD_HTML } from "./fixtures/ayntec";

const SOURCE_URL =
  "https://www.ayntec.com/pages/shipment-dashboard?section_id=main-page";

describe("parseAyntecSnapshotState", () => {
  it("accepts a structurally consistent AYN snapshot", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );

    expect(parseAyntecSnapshotState(snapshot)).toEqual(snapshot);
  });

  it("rejects an unsupported AYN snapshot schema", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );

    expect(() => parseAyntecSnapshotState({
      ...snapshot,
      schemaVersion: 99,
    })).toThrow("Invalid persisted AYN snapshot");
  });

  it("rejects an AYN snapshot whose entry count is inconsistent", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );

    expect(() => parseAyntecSnapshotState({
      ...snapshot,
      entryCount: 999,
    })).toThrow("Invalid persisted AYN snapshot");
  });

  it("rejects an AYN snapshot with a corrupted entry identity", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const id = "2026-08-17|ayn thor rainbow pro";

    expect(() => parseAyntecSnapshotState({
      ...snapshot,
      entries: {
        ...snapshot.entries,
        [id]: { ...snapshot.entries[id], id: "corrupted" },
      },
    })).toThrow("Invalid persisted AYN snapshot");
  });

  it("rejects an AYN snapshot with an incomplete shipment row", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const id = "2026-08-17|ayn thor rainbow pro";

    expect(() => parseAyntecSnapshotState({
      ...snapshot,
      entries: {
        ...snapshot.entries,
        [id]: { ...snapshot.entries[id], details: "" },
      },
    })).toThrow("Invalid persisted AYN snapshot");
  });

  it("rejects an AYN snapshot whose latest date is inconsistent", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );

    expect(() => parseAyntecSnapshotState({
      ...snapshot,
      latestDate: "2026-08-15",
    })).toThrow("Invalid persisted AYN snapshot");
  });

  it.each(["sourceUrl", "checkedAt"] as const)(
    "rejects an AYN snapshot without %s metadata",
    async (field) => {
      const snapshot = await parseAyntecHtml(
        AYNTEC_DASHBOARD_HTML,
        SOURCE_URL,
        "2026-08-18T16:00:00.000Z",
      );

      expect(() => parseAyntecSnapshotState({
        ...snapshot,
        [field]: "",
      })).toThrow("Invalid persisted AYN snapshot");
    },
  );

  it("rejects an AYN entry whose key no longer matches its product", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const id = "2026-08-17|ayn thor rainbow pro";

    expect(() => parseAyntecSnapshotState({
      ...snapshot,
      entries: {
        ...snapshot.entries,
        [id]: { ...snapshot.entries[id], product: "AYN Thor White Pro" },
      },
    })).toThrow("Invalid persisted AYN snapshot");
  });

  it("rejects an AYN entry with a malformed persisted date", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const oldId = "2026-08-17|ayn thor rainbow pro";
    const newId = "not-a-date|ayn thor rainbow pro";
    const entries = { ...snapshot.entries };
    delete entries[oldId];
    entries[newId] = {
      ...snapshot.entries[oldId],
      id: newId,
      date: "not-a-date",
    };

    expect(() => parseAyntecSnapshotState({
      ...snapshot,
      latestDate: "not-a-date",
      entries,
    })).toThrow("Invalid persisted AYN snapshot");
  });
});
