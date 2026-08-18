import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../src/diff";
import { getAvailableRoomIds, type Snapshot } from "../src/model";
import { parseOakhouseHtml } from "../src/parser";
import { BASELINE_HTML } from "./fixtures/oakhouse";

const URL = "https://www.oakhouse.jp/eng/house/1142";

async function baseline(): Promise<Snapshot> {
  return parseOakhouseHtml(BASELINE_HTML, URL, "2026-08-17T17:00:00.000Z");
}

function refreshAvailability(snapshot: Snapshot): void {
  snapshot.availableRoomIds = getAvailableRoomIds(snapshot.allRooms);
  snapshot.availableRoomCount = snapshot.availableRoomIds.length;
}

describe("diffSnapshots", () => {
  it("ignores timestamps and row object order", async () => {
    const previous = await baseline();
    const current = structuredClone(previous);
    current.checkedAt = "2026-08-17T17:03:00.000Z";
    current.allRooms = Object.fromEntries(
      Object.entries(current.allRooms).reverse(),
    );

    expect(diffSnapshots(previous, current).hasChanges).toBe(false);
  });

  it("reports added, removed, and changed available rooms", async () => {
    const previous = await baseline();
    const current = structuredClone(previous);

    current.allRooms["11874"].status = "vacancy";
    current.allRooms["11874"].availability = "Available now";
    current.allRooms["11868"].status = "novacancy";
    current.allRooms["11868"].availability = "Full";
    current.allRooms["11873"].availability = "Available now";
    refreshAvailability(current);

    const diff = diffSnapshots(previous, current);

    expect(diff.added.map((room) => room.number)).toEqual(["211"]);
    expect(diff.removed.map((room) => room.number)).toEqual(["205"]);
    expect(diff.changed).toEqual([
      expect.objectContaining({
        before: expect.objectContaining({ number: "210" }),
        fields: [
          {
            field: "availability",
            before: "2026/08/27 ~",
            after: "Available now",
          },
        ],
      }),
    ]);
    expect(diff.beforeCount).toBe(4);
    expect(diff.afterCount).toBe(4);
    expect(diff.hasChanges).toBe(true);
  });

  it("reports a count change", async () => {
    const previous = await baseline();
    const current = structuredClone(previous);
    current.allRooms["11874"].status = "vacancy";
    current.allRooms["11874"].availability = "Available now";
    refreshAvailability(current);

    expect(diffSnapshots(previous, current)).toMatchObject({
      beforeCount: 4,
      afterCount: 5,
      hasChanges: true,
    });
  });

  it("reports a monthly price change for an available room", async () => {
    const previous = await baseline();
    const current = structuredClone(previous);
    current.allRooms["11862"].monthlyPrice = "¥74,000";

    expect(diffSnapshots(previous, current).changed).toEqual([
      expect.objectContaining({
        after: expect.objectContaining({ number: "113" }),
        fields: [
          {
            field: "monthlyPrice",
            before: "¥73,000",
            after: "¥74,000",
          },
        ],
      }),
    ]);
  });
});
