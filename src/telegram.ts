import type { FetchLike } from "./source";

interface TelegramResponse {
  ok: boolean;
}

const TELEGRAM_TIMEOUT_MS = 15_000;

export async function sendTelegramMessages(
  token: string,
  chatId: string,
  messages: string[],
  fetcher: FetchLike = fetch,
): Promise<void> {
  const endpoint =
    "https://api.telegram.org/bot" + token + "/sendMessage";

  for (const text of messages) {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          link_preview_options: { is_disabled: true },
        }),
      });
    } catch {
      throw new Error("Telegram request failed");
    }

    let payload: TelegramResponse = { ok: false };
    try {
      payload = await response.json<TelegramResponse>();
    } catch {
      payload = { ok: false };
    }
    if (!response.ok) {
      throw new Error(
        "Telegram send failed with HTTP " + response.status,
      );
    }
    if (!payload.ok) {
      throw new Error("Telegram rejected the message");
    }
  }
}
