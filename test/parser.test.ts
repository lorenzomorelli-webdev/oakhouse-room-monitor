import { describe, expect, it } from "vitest";
import { parseOakhouseHtml } from "../src/parser";
import {
  BASELINE_HTML,
  BASELINE_ROOMS,
  oakhousePage,
} from "./fixtures/oakhouse";

const URL = "https://www.oakhouse.jp/eng/house/1142";
const NOW = "2026-08-17T17:00:00.000Z";

describe("parseOakhouseHtml", () => {
  it("parses all rows and identifies the four available rooms", async () => {
    const snapshot = await parseOakhouseHtml(BASELINE_HTML, URL, NOW);

    expect(snapshot.parsedRoomCount).toBe(5);
    expect(snapshot.availableRoomCount).toBe(4);
    expect(snapshot.availableRoomIds).toEqual([
      "11862",
      "11868",
      "11871",
      "11873",
    ]);
    expect(snapshot.allRooms["11862"]).toMatchObject({
      number: "113",
      availability: "Available now",
      monthlyPrice: "¥73,000",
      area: "9.9 m²",
      roomType: "Single Room",
      floorPlan: "1R",
    });
    expect(snapshot.allRooms["11873"].availability).toBe("2026/08/27 ~");
    expect(snapshot.allRooms["11874"].availability).toBe("Full");
  });

  it("accepts zero vacancies when valid room rows exist", async () => {
    const rooms = BASELINE_ROOMS.map((room) => ({
      ...room,
      status: "novacancy" as const,
      availability: "Full",
    }));
    const snapshot = await parseOakhouseHtml(oakhousePage(rooms), URL, NOW);

    expect(snapshot.parsedRoomCount).toBe(5);
    expect(snapshot.availableRoomIds).toEqual([]);
  });

  it("rejects a page without room rows", async () => {
    await expect(
      parseOakhouseHtml("<html><body>maintenance</body></html>", URL, NOW),
    ).rejects.toThrow("No Oakhouse room rows found");
  });

  it("rejects duplicate stable room ids", async () => {
    const duplicate = oakhousePage([BASELINE_ROOMS[0], BASELINE_ROOMS[0]]);
    await expect(parseOakhouseHtml(duplicate, URL, NOW)).rejects.toThrow(
      "Duplicate Oakhouse room id: 11862",
    );
  });

  it("rejects unknown room statuses", async () => {
    const unknownStatus = BASELINE_HTML.replace(
      'data-status="vacancy"',
      'data-status="unknown"',
    );

    await expect(parseOakhouseHtml(unknownStatus, URL, NOW)).rejects.toThrow(
      "Unknown Oakhouse room status: unknown",
    );
  });

  it("rejects a row with a missing tracked field", async () => {
    const missingFloorPlan = oakhousePage([
      { ...BASELINE_ROOMS[0], floorPlan: "" },
    ]);

    await expect(
      parseOakhouseHtml(missingFloorPlan, URL, NOW),
    ).rejects.toThrow("Room 11862 is missing floorPlan");
  });

  it("uses the room number when the internal id is absent", async () => {
    const missingId = oakhousePage([
      { ...BASELINE_ROOMS[0], id: "" },
    ]);

    const snapshot = await parseOakhouseHtml(missingId, URL, NOW);

    expect(snapshot.availableRoomIds).toEqual(["number:113"]);
    expect(snapshot.allRooms["number:113"].number).toBe("113");
  });
});
