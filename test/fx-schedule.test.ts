import { describe, expect, it } from "vitest";
import { isFxDigestDue } from "../src/fx/schedule";

describe("isFxDigestDue", () => {
  it.each([
    "2026-08-20T07:00:00.000Z",
    "2026-08-20T11:00:00.000Z",
    "2026-08-20T15:00:00.000Z",
    "2026-08-20T19:00:00.000Z",
  ])("runs at the four summer slots in Italian local time: %s", (value) => {
    expect(isFxDigestDue(new Date(value))).toBe(true);
  });

  it.each([
    "2026-01-15T08:00:00.000Z",
    "2026-01-15T12:00:00.000Z",
    "2026-01-15T16:00:00.000Z",
    "2026-01-15T20:00:00.000Z",
  ])("automatically follows winter time in Italy: %s", (value) => {
    expect(isFxDigestDue(new Date(value))).toBe(true);
  });

  it.each([
    "2026-08-20T08:00:00.000Z",
    "2026-08-20T12:00:00.000Z",
    "2026-08-22T07:00:00.000Z",
    "invalid",
  ])("skips non-slot hours, weekends and invalid timestamps: %s", (value) => {
    expect(isFxDigestDue(new Date(value))).toBe(false);
  });
});
