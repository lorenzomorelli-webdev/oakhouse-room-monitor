import { describe, expect, it } from "vitest";
import { handleTelegramUpdate } from "../src/commands";
import {
  HEALTH_KEY,
  HEALTHY_STATE,
  SNAPSHOT_KEY,
  type HealthState,
  type MonitorEnv,
  type Snapshot,
} from "../src/model";
import type { MonitorDependencies } from "../src/monitor";
import { parseOakhouseHtml } from "../src/parser";
import { BASELINE_HTML } from "./fixtures/oakhouse";

const URL = "https://www.oakhouse.jp/eng/house/1142";
const ROOMS_URL = URL + "#room";
const NOW = "2026-08-17T17:30:00.000Z";

interface StateHarness {
  state: KVNamespace;
  writes: Array<{ key: string; value: string }>;
}

function createState(
  snapshot?: Snapshot,
  health: HealthState = HEALTHY_STATE,
): StateHarness {
  const values = new Map<string, string>();
  if (snapshot) {
    values.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
  }
  values.set(HEALTH_KEY, JSON.stringify(health));
  const writes: StateHarness["writes"] = [];
  return {
    state: {
      async get(key: string) {
        return values.get(key) ?? null;
      },
      async put(key: string, value: string) {
        writes.push({ key, value });
        values.set(key, value);
      },
    } as unknown as KVNamespace,
    writes,
  };
}

function update(text: string, chatId = 123456): unknown {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1_786_987_800,
      chat: { id: chatId, type: "private" },
      text,
    },
  };
}

function createHarness(
  snapshot?: Snapshot,
  health: HealthState = HEALTHY_STATE,
): {
  env: MonitorEnv;
  deps: MonitorDependencies;
  messages: string[];
  logs: Array<Record<string, unknown>>;
  loads: () => number;
  writes: StateHarness["writes"];
} {
  const state = createState(snapshot, health);
  const messages: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let loadCount = 0;
  return {
    env: {
      STATE: state.state,
      TARGET_URL: URL,
      ROOMS_URL,
      PROPERTY_NAME: "GRAN KOBE",
      FAILURE_THRESHOLD: "3",
      FETCH_TIMEOUT_MS: "15000",
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: "123456",
      TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    },
    deps: {
      async loadHtml() {
        loadCount += 1;
        return BASELINE_HTML;
      },
      async sendMessages(chunks) {
        messages.push(...chunks);
      },
      now() {
        return NOW;
      },
      log(event) {
        logs.push(event);
      },
    },
    messages,
    logs,
    loads: () => loadCount,
    writes: state.writes,
  };
}

describe("Telegram commands", () => {
  it("answers /start with the command guide without loading Oakhouse", async () => {
    const harness = createHarness();

    await handleTelegramUpdate(update("/start"), harness.env, harness.deps);

    expect(harness.loads()).toBe(0);
    expect(harness.messages.join("\n")).toContain("/status");
    expect(harness.messages.join("\n")).toContain("/test");
    expect(harness.messages.join("\n")).toContain(ROOMS_URL);
  });

  it("ignores every chat except the configured private chat", async () => {
    const harness = createHarness();

    await handleTelegramUpdate(update("/status", 999999), harness.env, harness.deps);

    expect(harness.loads()).toBe(0);
    expect(harness.messages).toEqual([]);
  });

  it("reports the persisted monitor state for /status without loading Oakhouse", async () => {
    const snapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-17T17:23:26.108Z",
    );
    const health: HealthState = {
      ...HEALTHY_STATE,
      lastSuccessAt: "2026-08-17T17:28:00.000Z",
    };
    const harness = createHarness(snapshot, health);

    await handleTelegramUpdate(
      update("/status@oakhouse_monitor_bot"),
      harness.env,
      harness.deps,
    );

    const text = harness.messages.join("\n");
    expect(harness.loads()).toBe(0);
    expect(text).toContain("monitor operativo");
    expect(text).toContain("Ultimo controllo confermato:");
    expect(text).toContain("Stanze analizzate: 5");
    expect(text).toContain("Camere disponibili: 4");
    expect(text).toContain("Ultimo snapshot notificato:");
    expect(text).toContain(ROOMS_URL);
    expect(harness.writes).toEqual([]);
  });

  it("sends a persisted, synthetic availability diff for /test", async () => {
    const snapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-17T17:23:26.108Z",
    );
    const harness = createHarness(snapshot);

    await handleTelegramUpdate(update("/test"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(harness.loads()).toBe(0);
    expect(text).toContain("🧪 TEST");
    expect(text).toContain("ultimo snapshot reale");
    expect(text).toContain("nessuna modifica reale");
    expect(text).toContain("➕ Camera 211");
    expect(text).toContain("Camere disponibili: 4 → 5");
    expect(harness.writes).toEqual([]);
  });

  it("uses the health heartbeat even when it is newer than the snapshot", async () => {
    const snapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-17T17:23:26.108Z",
    );
    const harness = createHarness(snapshot, {
      ...HEALTHY_STATE,
      lastSuccessAt: "2026-08-17T17:29:00.000Z",
    });

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(harness.loads()).toBe(0);
    expect(text).toContain(
      "Ultimo controllo confermato: 17/08/26, 19:29:00",
    );
    expect(text).toContain("Ultimo snapshot notificato:");
    expect(harness.writes).toEqual([]);
  });

  it("uses a newly notified snapshot when it is newer than the heartbeat", async () => {
    const snapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-17T17:30:00.000Z",
    );
    const harness = createHarness(snapshot, {
      ...HEALTHY_STATE,
      lastSuccessAt: "2026-08-17T17:28:00.000Z",
    });

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(harness.loads()).toBe(0);
    expect(text).toContain(
      "Ultimo controllo confermato: 17/08/26, 19:30:00",
    );
    expect(harness.writes).toEqual([]);
  });

  it("reports consecutive monitor failures without loading Oakhouse", async () => {
    const snapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-17T17:23:26.108Z",
    );
    const harness = createHarness(snapshot, {
      consecutiveFailures: 3,
      lastSuccessAt: "2026-08-17T17:28:00.000Z",
      lastErrorAt: "2026-08-17T17:31:00.000Z",
      lastError: "Oakhouse returned HTTP 503",
      outageDetected: true,
      alertSent: true,
    });

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(harness.loads()).toBe(0);
    expect(text).toContain("monitor con problemi");
    expect(text).toContain("3 errori consecutivi");
    expect(text).toContain("Ultimo errore registrato:");
    expect(text).toContain("Oakhouse returned HTTP 503");
    expect(harness.writes).toEqual([]);
  });

  it("reports initial monitor failures even before a snapshot exists", async () => {
    const harness = createHarness(undefined, {
      consecutiveFailures: 3,
      lastSuccessAt: null,
      lastErrorAt: "2026-08-17T17:31:00.000Z",
      lastError: "Oakhouse returned HTTP 503",
      outageDetected: true,
      alertSent: true,
    });

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(harness.loads()).toBe(0);
    expect(text).toContain("monitor con problemi");
    expect(text).toContain("Ultimo controllo confermato: non ancora disponibile");
    expect(text).toContain("Snapshot: non ancora disponibile");
    expect(text).toContain("3 errori consecutivi");
    expect(text).toContain("Oakhouse returned HTTP 503");
    expect(text).not.toContain("comando /status non riuscito");
    expect(harness.writes).toEqual([]);
  });

  it("shows the guide for an unsupported command", async () => {
    const harness = createHarness();

    await handleTelegramUpdate(update("/unknown"), harness.env, harness.deps);

    expect(harness.messages.join("\n")).toContain("Comando non riconosciuto");
    expect(harness.loads()).toBe(0);
  });

  it("never copies an unknown user token into messages or logs", async () => {
    const harness = createHarness();
    const sensitiveInput = "local-sensitive-input-do-not-log";

    await handleTelegramUpdate(update(sensitiveInput), harness.env, harness.deps);

    expect(JSON.stringify({
      messages: harness.messages,
      logs: harness.logs,
    })).not.toContain(sensitiveInput);
  });

  it("rejects when neither the command reply nor its fallback can be delivered", async () => {
    const harness = createHarness();
    const deps: MonitorDependencies = {
      ...harness.deps,
      async sendMessages() {
        throw new Error("Injected Telegram outage");
      },
    };

    await expect(
      handleTelegramUpdate(update("/start"), harness.env, deps),
    ).rejects.toThrow("Telegram command delivery failed");
  });
});
