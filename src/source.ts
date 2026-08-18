export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function fetchOakhouseHtml(
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
      "user-agent": "OakhouseRoomMonitor/1.0",
    },
  });

  if (!response.ok) {
    throw new Error("Oakhouse returned HTTP " + response.status);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error("Oakhouse response is not HTML");
  }
  return response.text();
}
