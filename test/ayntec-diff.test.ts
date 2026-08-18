import { describe, expect, it } from "vitest";
import { diffAyntecSnapshots } from "../src/ayntec/diff";
import type { ShipmentEntry } from "../src/ayntec/model";
import { parseAyntecHtml } from "../src/ayntec/parser";
import { AYNTEC_DASHBOARD_HTML } from "./fixtures/ayntec";

const SOURCE_URL =
  "https://www.ayntec.com/pages/shipment-dashboard?section_id=main-page";

describe("diffAyntecSnapshots", () => {
  it("reports added, removed, and changed shipment rows", async () => {
    const previous = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const current = structuredClone(previous);
    delete current.entries["2026-08-15|ayn thor black pro"];
    current.entries["2026-08-17|ayn thor rainbow pro"].details =
      "2502xx--2540xx";
    const added: ShipmentEntry = {
      id: "2026-08-18|ayn thor white max",
      date: "2026-08-18",
      product: "AYN Thor White Max",
      details: "2381xx--2400xx",
    };
    current.entries[added.id] = added;
    current.entryCount = 5;
    current.latestDate = "2026-08-18";
    current.checkedAt = "2026-08-18T16:30:00.000Z";

    const diff = diffAyntecSnapshots(previous, current);

    expect(diff.added).toEqual([added]);
    expect(diff.removed).toEqual([
      previous.entries["2026-08-15|ayn thor black pro"],
    ]);
    expect(diff.changed).toEqual([
      {
        before: expect.objectContaining({
          id: "2026-08-17|ayn thor rainbow pro",
          details: "2502xx--2529xx",
        }),
        after: expect.objectContaining({ details: "2502xx--2540xx" }),
      },
    ]);
    expect(diff).toMatchObject({
      beforeCount: 5,
      afterCount: 5,
      hasChanges: true,
    });
  });
});
