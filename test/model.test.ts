import { describe, expect, it } from "vitest";
import {
  getAvailableRoomIds,
  normalizeText,
  type Room,
} from "../src/model";

const rooms: Record<string, Room> = {
  "2": {
    id: "2",
    number: "210",
    status: "vacancy",
    availability: "2026/08/27 ~",
    monthlyPrice: "¥75,000",
    area: "10 m²",
    roomType: "Single Room",
    floorPlan: "1R",
  },
  "1": {
    id: "1",
    number: "113",
    status: "vacancy",
    availability: "Available now",
    monthlyPrice: "¥73,000",
    area: "9.9 m²",
    roomType: "Single Room",
    floorPlan: "1R",
  },
  "3": {
    id: "3",
    number: "205",
    status: "novacancy",
    availability: "Full",
    monthlyPrice: "¥75,000",
    area: "10 m²",
    roomType: "Single Room",
    floorPlan: "1R",
  },
};

describe("domain normalization", () => {
  it("collapses whitespace and non-breaking spaces", () => {
    expect(normalizeText("  2026/08/27\u00a0  ~ \n")).toBe("2026/08/27 ~");
  });

  it("returns available room ids ordered by room number", () => {
    expect(getAvailableRoomIds(rooms)).toEqual(["1", "2"]);
  });
});
