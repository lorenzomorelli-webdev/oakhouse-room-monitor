import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../src/diff";
import {
  formatDiffMessage,
  formatFailureMessage,
  formatInitialMessage,
  formatRecoveryMessage,
  splitTelegramText,
} from "../src/messages";
import { getAvailableRoomIds } from "../src/model";
import { parseOakhouseHtml } from "../src/parser";
import { BASELINE_HTML } from "./fixtures/oakhouse";

const URL = "https://www.oakhouse.jp/eng/house/1142";
const ROOMS_URL = URL + "#room";

describe("Telegram messages", () => {
  it("renders the initial four-room baseline", async () => {
    const snapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-17T17:00:00.000Z",
    );
    const text = formatInitialMessage(snapshot, "GRAN KOBE", ROOMS_URL);

    expect(text).toContain("✅ GRAN KOBE — monitor attivato");
    expect(text).toContain("Camere disponibili: 4");
    expect(text).toContain("Camera 113");
    expect(text).toContain("Camera 210");
    expect(text).toContain(ROOMS_URL);
  });

  it("renders additions, removals, and before-to-after changes", async () => {
    const previous = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-17T17:00:00.000Z",
    );
    const current = structuredClone(previous);
    current.allRooms["11874"].status = "vacancy";
    current.allRooms["11874"].availability = "Available now";
    current.allRooms["11868"].status = "novacancy";
    current.allRooms["11873"].availability = "Available now";
    current.availableRoomIds = getAvailableRoomIds(current.allRooms);
    current.availableRoomCount = current.availableRoomIds.length;

    const text = formatDiffMessage(
      diffSnapshots(previous, current),
      "GRAN KOBE",
      ROOMS_URL,
    );

    expect(text).toContain("➕ Camera 211");
    expect(text).toContain("➖ Camera 205");
    expect(text).toContain("2026/08/27 ~ → subito");
    expect(text).toContain("Camere disponibili: 4 → 4");
  });

  it("formats outage and recovery messages without secret data", () => {
    expect(
      formatFailureMessage("GRAN KOBE", 3, "HTTP 503", ROOMS_URL),
    ).toContain("3 controlli consecutivi");
    expect(formatRecoveryMessage("GRAN KOBE", ROOMS_URL)).toContain(
      "monitor nuovamente operativo",
    );
  });

  it("splits text below Telegram's 4096-character limit", () => {
    const chunks = splitTelegramText("x".repeat(9000));
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.length <= 4000)).toBe(true);
  });
});
