import type { FetchLike } from "./source";
export { TELEGRAM_COMMANDS } from "./bot-commands";
import { TELEGRAM_COMMANDS } from "./bot-commands";

interface TelegramResponse<Result = unknown> {
  ok: boolean;
  result?: Result;
}

const TELEGRAM_TIMEOUT_MS = 15_000;

async function callTelegramMethod<Result = unknown>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: FetchLike,
): Promise<Result | undefined> {
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

  let payload: TelegramResponse<Result> = { ok: false };
  try {
    payload = await response.json<TelegramResponse<Result>>();
  } catch {
    payload = { ok: false };
  }
  if (!response.ok) {
    throw new Error("Telegram API failed with HTTP " + response.status);
  }
  if (!payload.ok) {
    throw new Error("Telegram rejected the request");
  }
  return payload.result;
}

function hasExpectedCommands(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== TELEGRAM_COMMANDS.length) {
    return false;
  }
  return TELEGRAM_COMMANDS.every((expected, index) => {
    const actual: unknown = value[index];
    return typeof actual === "object" && actual !== null &&
      "command" in actual && actual.command === expected.command &&
      "description" in actual &&
      actual.description === expected.description;
  });
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
  const scopes = [
    { type: "default" },
    { type: "chat", chat_id: chatId },
  ];
  for (const scope of scopes) {
    for (const languageCode of [undefined, "it", "en"] as const) {
      const scopedLanguage = {
        scope,
        ...(languageCode ? { language_code: languageCode } : {}),
      };
      await callTelegramMethod(
        token,
        "deleteMyCommands",
        scopedLanguage,
        fetcher,
      );
      await callTelegramMethod(
        token,
        "setMyCommands",
        {
          commands: TELEGRAM_COMMANDS,
          ...scopedLanguage,
        },
        fetcher,
      );
      const persistedCommands = await callTelegramMethod(
        token,
        "getMyCommands",
        scopedLanguage,
        fetcher,
      );
      if (!hasExpectedCommands(persistedCommands)) {
        throw new Error("Telegram command menu verification failed");
      }
    }
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
  const menuButton = await callTelegramMethod(
    token,
    "getChatMenuButton",
    { chat_id: chatId },
    fetcher,
  );
  if (
    typeof menuButton !== "object" ||
    menuButton === null ||
    !("type" in menuButton) ||
    menuButton.type !== "commands"
  ) {
    throw new Error("Telegram menu button verification failed");
  }
}
