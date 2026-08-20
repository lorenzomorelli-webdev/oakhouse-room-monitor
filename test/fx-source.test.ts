import { describe, expect, it } from "vitest";
import { fetchFxTimeSeries } from "../src/fx/source";
import type { FetchLike } from "../src/source";
import { TWELVE_DATA_EUR_JPY_RESPONSE } from "./fixtures/fx";

describe("fetchFxTimeSeries", () => {
  it("requests one year of EUR/JPY daily candles with header authentication", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetcher: FetchLike = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json(TWELVE_DATA_EUR_JPY_RESPONSE);
    };

    await expect(
      fetchFxTimeSeries(
        "https://api.twelvedata.com/time_series",
        "private-api-key",
        15_000,
        fetcher,
      ),
    ).resolves.toEqual(TWELVE_DATA_EUR_JPY_RESPONSE);

    const url = new URL(capturedUrl);
    expect(url.origin + url.pathname).toBe(
      "https://api.twelvedata.com/time_series",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      symbol: "EUR/JPY",
      interval: "1day",
      outputsize: "366",
      timezone: "Europe/Rome",
      dp: "5",
      format: "JSON",
      previous_close: "true",
      order: "desc",
    });
    expect(url.search).not.toContain("private-api-key");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("authorization")).toBe("apikey private-api-key");
    expect(headers.get("accept")).toBe("application/json");
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a non-successful response without exposing the API key", async () => {
    const fetcher: FetchLike = async () =>
      Response.json({ status: "error" }, { status: 429 });

    const promise = fetchFxTimeSeries(
      "https://api.twelvedata.com/time_series",
      "private-api-key",
      15_000,
      fetcher,
    );
    await expect(promise).rejects.toThrow("Twelve Data returned HTTP 429");
    await expect(promise).rejects.not.toThrow("private-api-key");
  });

  it("rejects a non-JSON response", async () => {
    const fetcher: FetchLike = async () =>
      new Response("maintenance", {
        headers: { "content-type": "text/html" },
      });

    await expect(
      fetchFxTimeSeries(
        "https://api.twelvedata.com/time_series",
        "private-api-key",
        15_000,
        fetcher,
      ),
    ).rejects.toThrow("Twelve Data response is not JSON");
  });

  it("redacts provider transport errors", async () => {
    const fetcher: FetchLike = async () => {
      throw new Error("transport leaked private-api-key");
    };

    const promise = fetchFxTimeSeries(
      "https://api.twelvedata.com/time_series",
      "private-api-key",
      15_000,
      fetcher,
    );
    await expect(promise).rejects.toThrow("Twelve Data request failed");
    await expect(promise).rejects.not.toThrow("private-api-key");
  });
});
