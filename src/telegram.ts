import type { FetchLike } from "./source";
export { TELEGRAM_COMMANDS } from "./bot-commands";
import { TELEGRAM_COMMANDS } from "./bot-commands";

interface TelegramResponse {
  ok: boolean;
}

const TELEGRAM_TIMEOUT_MS = 15_000;

async function callTelegramMethod(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: FetchLike,
): Promise<void> {
  const endpoint = "https://api.telegram.org/bot" + token + "/" + method;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
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
    throw new Error("Telegram API failed with HTTP " + response.status);
  }
  if (!payload.ok) {
    throw new Error("Telegram rejected the request");
  }
}

export async function sendTelegramMessages(
  token: string,
  chatId: string,
  messages: string[],
  fetcher: FetchLike = fetch,
): Promise<void> {
  for (const text of messages) {
    try {
      await callTelegramMethod(
        token,
        "sendMessage",
        {
          chat_id: chatId,
          text,
          link_preview_options: { is_disabled: true },
        },
        fetcher,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Telegram API failed with HTTP ")
      ) {
        throw new Error(
          error.message.replace("Telegram API", "Telegram send"),
        );
      }
      throw error;
    }
  }
}

export async function syncTelegramCommandMenu(
  token: string,
  chatId: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  const scope = { type: "chat", chat_id: chatId };
  for (const languageCode of [undefined, "it", "en"] as const) {
    await callTelegramMethod(
      token,
      "setMyCommands",
      {
        commands: TELEGRAM_COMMANDS,
        scope,
        ...(languageCode ? { language_code: languageCode } : {}),
      },
      fetcher,
    );
  }
  await callTelegramMethod(
    token,
    "setChatMenuButton",
    {
      chat_id: chatId,
      menu_button: { type: "commands" },
    },
    fetcher,
  );
}
