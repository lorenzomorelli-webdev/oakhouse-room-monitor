import { describe, expect, it } from "vitest";
import {
  sendTelegramMessages,
  syncTelegramCommandMenu,
  TELEGRAM_COMMANDS,
} from "../src/telegram";
import type { FetchLike } from "../src/source";

describe("sendTelegramMessages", () => {
  it("sends each chunk in order with link previews disabled", async () => {
    const bodies: unknown[] = [];
    const fetcher: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: { message_id: bodies.length } });
    };

    await sendTelegramMessages(
      "secret-token",
      "123456",
      ["first", "second"],
      fetcher,
    );

    expect(bodies).toEqual([
      {
        chat_id: "123456",
        text: "first",
        link_preview_options: { is_disabled: true },
      },
      {
        chat_id: "123456",
        text: "second",
        link_preview_options: { is_disabled: true },
      },
    ]);
  });

  it("throws a redacted error when Telegram rejects a message", async () => {
    const fetcher: FetchLike = async () =>
      Response.json(
        { ok: false, description: "rejected" },
        { status: 400 },
      );

    const promise = sendTelegramMessages(
      "secret-token",
      "123456",
      ["message"],
      fetcher,
    );
    await expect(promise).rejects.toThrow("Telegram send failed with HTTP 400");
    await expect(promise).rejects.not.toThrow("secret-token");
  });

  it("redacts transport errors and attaches a timeout signal", async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher: FetchLike = async (_input, init) => {
      signal = init?.signal;
      throw new Error("request exposed secret-token and chat 123456");
    };

    const promise = sendTelegramMessages(
      "secret-token",
      "123456",
      ["message"],
      fetcher,
    );

    await expect(promise).rejects.toThrow("Telegram request failed");
    await expect(promise).rejects.not.toThrow("secret-token");
    await expect(promise).rejects.not.toThrow("123456");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("stops after a partially delivered multi-chunk message", async () => {
    const delivered: string[] = [];
    const fetcher: FetchLike = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      if (body.text === "second") {
        return Response.json({ ok: false }, { status: 503 });
      }
      delivered.push(body.text);
      return Response.json({ ok: true });
    };

    await expect(
      sendTelegramMessages(
        "secret-token",
        "123456",
        ["first", "second", "third"],
        fetcher,
      ),
    ).rejects.toThrow("Telegram send failed with HTTP 503");
    expect(delivered).toEqual(["first"]);
  });
});

describe("syncTelegramCommandMenu", () => {
  it("defines all commands for the exact chat and forces its menu button", async () => {
    expect(TELEGRAM_COMMANDS.map(({ command }) => command)).toEqual([
      "start",
      "status",
      "test",
      "test_ayntec",
      "help",
    ]);
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    const fetcher: FetchLike = async (input, init) => {
      requests.push({
        method: String(input).split("/").at(-1)!,
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({ ok: true, result: true });
    };

    await syncTelegramCommandMenu(
      "secret-token",
      "123456",
      fetcher,
    );

    expect(requests).toEqual([
      {
        method: "setMyCommands",
        body: {
          commands: TELEGRAM_COMMANDS,
          scope: { type: "chat", chat_id: "123456" },
        },
      },
      {
        method: "setMyCommands",
        body: {
          commands: TELEGRAM_COMMANDS,
          scope: { type: "chat", chat_id: "123456" },
          language_code: "it",
        },
      },
      {
        method: "setMyCommands",
        body: {
          commands: TELEGRAM_COMMANDS,
          scope: { type: "chat", chat_id: "123456" },
          language_code: "en",
        },
      },
      {
        method: "setChatMenuButton",
        body: {
          chat_id: "123456",
          menu_button: { type: "commands" },
        },
      },
    ]);
  });
});
