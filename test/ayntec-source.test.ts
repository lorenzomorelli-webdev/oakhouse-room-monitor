import { describe, expect, it } from "vitest";
import { fetchAyntecHtml } from "../src/ayntec/source";
import type { FetchLike } from "../src/source";

describe("fetchAyntecHtml", () => {
  it("requests the compact Shopify HTML section without stale caching", async () => {
    let captured: RequestInit | undefined;
    const fetcher: FetchLike = async (_input, init) => {
      captured = init;
      return new Response("<div class=\"rte\">shipments</div>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    };

    await expect(
      fetchAyntecHtml(
        "https://www.ayntec.com/pages/shipment-dashboard?section_id=main-page",
        15000,
        fetcher,
      ),
    ).resolves.toContain("shipments");
    const headers = new Headers(captured?.headers);
    expect(headers.get("cache-control")).toBe("no-cache");
    expect(headers.get("user-agent")).toBe("AyntecShipmentMonitor/1.0");
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a non-successful Shopify response", async () => {
    const fetcher: FetchLike = async () =>
      new Response("down", { status: 503 });

    await expect(
      fetchAyntecHtml("https://www.ayntec.com/dashboard", 15000, fetcher),
    ).rejects.toThrow("AYN returned HTTP 503");
  });

  it("rejects a non-HTML Shopify response", async () => {
    const fetcher: FetchLike = async () =>
      new Response("{}", {
        headers: { "content-type": "application/json" },
      });

    await expect(
      fetchAyntecHtml("https://www.ayntec.com/dashboard", 15000, fetcher),
    ).rejects.toThrow("AYN response is not HTML");
  });
});
