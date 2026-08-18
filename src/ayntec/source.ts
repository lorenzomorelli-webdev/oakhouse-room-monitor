import type { FetchLike } from "../source";

export async function fetchAyntecHtml(
  url: string,
  timeoutMs: number,
  fetcher: FetchLike = fetch,
): Promise<string> {
  const response = await fetcher(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en",
      "cache-control": "no-cache",
      "user-agent": "AyntecShipmentMonitor/1.0",
    },
  });
  if (!response.ok) {
    throw new Error("AYN returned HTTP " + response.status);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error("AYN response is not HTML");
  }
  return response.text();
}
