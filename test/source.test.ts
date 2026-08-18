import { describe, expect, it } from "vitest";
import { fetchOakhouseHtml, type FetchLike } from "../src/source";

describe("fetchOakhouseHtml", () => {
  it("requests English HTML without accepting a cached response", async () => {
    let captured: RequestInit | undefined;
    const fetcher: FetchLike = async (_input, init) => {
      captured = init;
      return new Response("<html>rooms</html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    };

    await expect(
      fetchOakhouseHtml("https://example.com/house", 15000, fetcher),
    ).resolves.toBe("<html>rooms</html>");
    expect(new Headers(captured?.headers).get("accept-language")).toBe("en");
    expect(new Headers(captured?.headers).get("cache-control")).toBe(
      "no-cache",
    );
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects non-success HTTP responses", async () => {
    const fetcher: FetchLike = async () => new Response("down", { status: 503 });
    await expect(
      fetchOakhouseHtml("https://example.com/house", 15000, fetcher),
    ).rejects.toThrow("Oakhouse returned HTTP 503");
  });

  it("rejects a non-HTML response", async () => {
    const fetcher: FetchLike = async () =>
      new Response("{}", { headers: { "content-type": "application/json" } });
    await expect(
      fetchOakhouseHtml("https://example.com/house", 15000, fetcher),
    ).rejects.toThrow("Oakhouse response is not HTML");
  });
});
