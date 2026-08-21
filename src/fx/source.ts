import type { FetchLike } from "../source";

export async function fetchFxQuote(
  apiUrl: string,
  apiKey: string,
  timeoutMs: number,
  fetcher: FetchLike = fetch,
): Promise<unknown> {
  const url = new URL(apiUrl);
  url.search = new URLSearchParams({
    symbol: "EUR/JPY",
    interval: "1day",
    dp: "5",
  }).toString();

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
        authorization: "apikey " + apiKey,
        "cache-control": "no-cache",
        "user-agent": "ScanningLolloFxMonitor/1.0",
      },
    });
  } catch {
    throw new Error("Twelve Data request failed");
  }

  if (!response.ok) {
    throw new Error("Twelve Data returned HTTP " + response.status);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Twelve Data response is not JSON");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Twelve Data response contains invalid JSON");
  }
}
