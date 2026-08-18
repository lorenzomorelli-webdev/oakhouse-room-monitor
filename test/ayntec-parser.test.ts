import { describe, expect, it } from "vitest";
import { parseAyntecHtml } from "../src/ayntec/parser";
import { AYNTEC_DASHBOARD_HTML } from "./fixtures/ayntec";

const SOURCE_URL =
  "https://www.ayntec.com/pages/shipment-dashboard?section_id=main-page";
const NOW = "2026-08-18T16:00:00.000Z";

describe("parseAyntecHtml", () => {
  it("parses dated shipment rows and identifies the latest dashboard date", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      NOW,
    );

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      sourceUrl: SOURCE_URL,
      checkedAt: NOW,
      entryCount: 5,
      latestDate: "2026-08-17",
    });
    expect(snapshot.entries["2026-08-15|ayn thor black pro"]).toEqual({
      id: "2026-08-15|ayn thor black pro",
      date: "2026-08-15",
      product: "AYN Thor Black Pro",
      details: "2448xx--2471xx",
    });
    expect(snapshot.entries["2026-08-17|ayn thor rainbow max(512)"]).toEqual({
      id: "2026-08-17|ayn thor rainbow max(512)",
      date: "2026-08-17",
      product: "AYN Thor Rainbow Max(512)",
      details: "2472xx--2600xx",
    });
  });

  it("rejects a response without shipment entries", async () => {
    await expect(
      parseAyntecHtml(
        '<div class="rte"><p>maintenance</p></div>',
        SOURCE_URL,
        NOW,
      ),
    ).rejects.toThrow("No AYN shipment entries found");
  });

  it("rejects duplicate rows for the same date and product", async () => {
    const html = `
      <div class="rte">
        <p><strong>2026/8/17</strong></p>
        <p>AYN Thor Black Pro: 2471xx--2493xx</p>
        <p>AYN Thor Black Pro: 2493xx--2500xx</p>
      </div>`;

    await expect(parseAyntecHtml(html, SOURCE_URL, NOW)).rejects.toThrow(
      "Duplicate AYN shipment entry: 2026-08-17|ayn thor black pro",
    );
  });

  it("rejects non-empty content that cannot be parsed as a shipment row", async () => {
    const html = `
      <div class="rte">
        <p><strong>2026/8/17</strong></p>
        <p>Shipping will resume shortly</p>
      </div>`;

    await expect(parseAyntecHtml(html, SOURCE_URL, NOW)).rejects.toThrow(
      "Malformed AYN shipment row: Shipping will resume shortly",
    );
  });

  it("rejects impossible shipment dates", async () => {
    const html = `
      <div class="rte">
        <p><strong>2026/13/40</strong></p>
        <p>AYN Thor Black Pro: 2471xx--2493xx</p>
      </div>`;

    await expect(parseAyntecHtml(html, SOURCE_URL, NOW)).rejects.toThrow(
      "Invalid AYN shipment date: 2026/13/40",
    );
  });
});
