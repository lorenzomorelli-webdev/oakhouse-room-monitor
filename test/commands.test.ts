import { describe, expect, it } from "vitest";
import {
  AYNTEC_HEALTH_KEY,
  AYNTEC_SNAPSHOT_KEY,
} from "../src/ayntec/monitor";
import type { AyntecSnapshot } from "../src/ayntec/model";
import { parseAyntecHtml } from "../src/ayntec/parser";
import { handleTelegramUpdate } from "../src/commands";
import {
  FX_HEALTH_KEY,
  FX_SNAPSHOT_KEY,
  type FxSnapshot,
} from "../src/fx/model";
import { parseFxQuote } from "../src/fx/parser";
import {
  HEALTH_KEY,
  HEALTHY_STATE,
  SNAPSHOT_KEY,
  type HealthState,
  type WorkerEnv,
  type Snapshot,
} from "../src/model";
import type { MonitorDependencies } from "../src/monitor";
import { parseOakhouseHtml } from "../src/parser";
import { BASELINE_HTML } from "./fixtures/oakhouse";
import { AYNTEC_DASHBOARD_HTML } from "./fixtures/ayntec";
import { TWELVE_DATA_EUR_JPY_RESPONSE } from "./fixtures/fx";

const URL = "https://www.oakhouse.jp/eng/house/1142";
const ROOMS_URL = URL + "#room";
const NOW = "2026-08-17T17:30:00.000Z";
const AYN_TARGET_URL =
  "https://www.ayntec.com/pages/shipment-dashboard?section_id=main-page";
const AYN_DASHBOARD_URL =
  "https://www.ayntec.com/pages/shipment-dashboard";
const FX_API_URL = "https://api.twelvedata.com/quote";
const FX_PAGE_URL =
  "https://mercati.ilsole24ore.com/tassi-e-valute/valute/contro-euro/cambio/JPYVS.FX";

interface StateHarness {
  state: KVNamespace;
  writes: Array<{ key: string; value: string }>;
  deletes: string[];
  setRaw(key: string, value: string): void;
}

function createState(
  snapshot?: Snapshot,
  health: HealthState = HEALTHY_STATE,
  ayntecSnapshot?: AyntecSnapshot,
  ayntecHealth: HealthState = HEALTHY_STATE,
  fxSnapshot?: FxSnapshot,
  fxHealth: HealthState = HEALTHY_STATE,
): StateHarness {
  const values = new Map<string, string>();
  if (snapshot) {
    values.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
  }
  values.set(HEALTH_KEY, JSON.stringify(health));
  if (ayntecSnapshot) {
    values.set(AYNTEC_SNAPSHOT_KEY, JSON.stringify(ayntecSnapshot));
  }
  values.set(AYNTEC_HEALTH_KEY, JSON.stringify(ayntecHealth));
  if (fxSnapshot) {
    values.set(FX_SNAPSHOT_KEY, JSON.stringify(fxSnapshot));
  }
  values.set(FX_HEALTH_KEY, JSON.stringify(fxHealth));
  const writes: StateHarness["writes"] = [];
  const deletes: string[] = [];
  return {
    state: {
      async get(key: string) {
        return values.get(key) ?? null;
      },
      async put(key: string, value: string) {
        writes.push({ key, value });
        values.set(key, value);
      },
      async delete(key: string) {
        deletes.push(key);
        values.delete(key);
      },
    } as unknown as KVNamespace,
    writes,
    deletes,
    setRaw(key, value) {
      values.set(key, value);
    },
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
  ayntecSnapshot?: AyntecSnapshot,
  ayntecHealth: HealthState = HEALTHY_STATE,
  fxSnapshot?: FxSnapshot,
  fxHealth: HealthState = HEALTHY_STATE,
): {
  env: WorkerEnv;
  deps: MonitorDependencies;
  messages: string[];
  logs: Array<Record<string, unknown>>;
  loads: () => number;
  fxLoads: () => number;
  menuSyncs: () => number;
  writes: StateHarness["writes"];
  deletes: string[];
  setRawState(key: string, value: string): void;
} {
  const state = createState(
    snapshot,
    health,
    ayntecSnapshot,
    ayntecHealth,
    fxSnapshot,
    fxHealth,
  );
  const messages: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let loadCount = 0;
  let fxLoadCount = 0;
  let menuSyncCount = 0;
  return {
    env: {
      STATE: state.state,
      TARGET_URL: URL,
      ROOMS_URL,
      PROPERTY_NAME: "GRAN KOBE",
      AYN_TARGET_URL,
      AYN_DASHBOARD_URL,
      FX_API_URL,
      FX_PAGE_URL,
      TWELVE_DATA_API_KEY: "test-fx-key",
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
      async loadFxSnapshot() {
        fxLoadCount += 1;
        return parseFxQuote(
          structuredClone(TWELVE_DATA_EUR_JPY_RESPONSE),
          FX_API_URL,
          "2026-08-20T07:00:00.000Z",
        );
      },
      async sendMessages(chunks) {
        messages.push(...chunks);
      },
      async syncCommandMenu() {
        menuSyncCount += 1;
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
    fxLoads: () => fxLoadCount,
    menuSyncs: () => menuSyncCount,
    writes: state.writes,
    deletes: state.deletes,
    setRawState: state.setRaw,
  };
}

describe("Telegram commands", () => {
  it("answers /start with the command guide without loading Oakhouse", async () => {
    const harness = createHarness();

    await handleTelegramUpdate(update("/start"), harness.env, harness.deps);

    expect(harness.loads()).toBe(0);
    expect(harness.menuSyncs()).toBe(1);
    expect(harness.messages.join("\n")).toContain("/status");
    expect(harness.messages.join("\n")).toContain("/test");
    expect(harness.messages.join("\n")).toContain("/test_ayntec");
    expect(harness.messages.join("\n")).toContain("/yen");
    expect(harness.messages.join("\n")).toContain("/set_yen");
    expect(harness.messages.join("\n")).toContain("/clear_yen");
    expect(harness.messages.join("\n")).toContain("/test_yen");
    expect(harness.messages.join("\n")).toContain(ROOMS_URL);
    expect(harness.messages.join("\n")).toContain(AYN_DASHBOARD_URL);
    expect(harness.messages.join("\n")).toContain(FX_PAGE_URL);
  });

  it("still answers /help when Telegram menu synchronization fails", async () => {
    const harness = createHarness();
    const deps: MonitorDependencies = {
      ...harness.deps,
      async syncCommandMenu() {
        throw new Error("Injected menu API outage");
      },
    };

    await handleTelegramUpdate(update("/help"), harness.env, deps);

    expect(harness.messages.join("\n")).toContain("/test_ayntec");
    expect(harness.logs).toContainEqual({
      level: "error",
      event: "telegram_command_menu_sync_failed",
    });
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

  it("adds the persisted AYN state to the aggregate /status response", async () => {
    const oakhouseSnapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-18T15:55:00.000Z",
    );
    const ayntecSnapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      AYN_TARGET_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const harness = createHarness(
      oakhouseSnapshot,
      HEALTHY_STATE,
      ayntecSnapshot,
      { ...HEALTHY_STATE, lastSuccessAt: "2026-08-18T16:30:00.000Z" },
    );

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(text).toContain("GRAN KOBE — monitor operativo");
    expect(text).toContain("AYN Shipping Dashboard — monitor operativo");
    expect(text).toContain("Ultima data pubblicata: 17/08/2026");
    expect(text).toContain("Righe monitorate: 5");
    expect(text).toContain(AYN_DASHBOARD_URL);
    expect(harness.loads()).toBe(0);
    expect(harness.writes).toEqual([]);
  });

  it("still reports Oakhouse when the persisted AYN state is invalid", async () => {
    const oakhouseSnapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-18T15:55:00.000Z",
    );
    const harness = createHarness(oakhouseSnapshot);
    harness.setRawState(
      AYNTEC_SNAPSHOT_KEY,
      JSON.stringify({ schemaVersion: 999, entries: {} }),
    );

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(text).toContain("✅ GRAN KOBE — monitor operativo");
    expect(text).toContain(
      "⚠️ AYN Shipping Dashboard — stato non disponibile",
    );
    expect(text).toContain(AYN_DASHBOARD_URL);
    expect(text).not.toContain("comando /status non riuscito");
    expect(harness.writes).toEqual([]);
  });

  it("sends a persisted synthetic shipment diff for /test_ayntec", async () => {
    const ayntecSnapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      AYN_TARGET_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const harness = createHarness(
      undefined,
      HEALTHY_STATE,
      ayntecSnapshot,
    );

    await handleTelegramUpdate(
      update("/test_ayntec"),
      harness.env,
      harness.deps,
    );

    const text = harness.messages.join("\n");
    expect(text).toContain("🧪 TEST AYN");
    expect(text).toContain("nessuna modifica reale");
    expect(text).toContain("NESSUNA RILEVAZIONE REALE");
    expect(text).toContain("Batch simulato");
    expect(text).toContain("18/08/2026");
    expect(text).toContain(AYN_DASHBOARD_URL);
    expect(harness.loads()).toBe(0);
    expect(harness.writes).toEqual([]);
  });

  it("adds the persisted EUR/JPY state to the aggregate /status response", async () => {
    const fxSnapshot = parseFxQuote(
      structuredClone(TWELVE_DATA_EUR_JPY_RESPONSE),
      FX_API_URL,
      "2026-08-20T07:00:00.000Z",
    );
    const harness = createHarness(
      undefined,
      HEALTHY_STATE,
      undefined,
      HEALTHY_STATE,
      fxSnapshot,
      { ...HEALTHY_STATE, lastSuccessAt: fxSnapshot.checkedAt },
    );

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(text).toContain("EUR/JPY — monitor operativo");
    expect(text).toContain("Ultimo cambio: 185,4255 JPY per 1 EUR");
    expect(text).toContain("Target attivo: nessuno");
    expect(text).toContain("Controllo target: ogni 3 minuti (lun–ven)");
    expect(text).toContain("10:00 e 17:00");
    expect(text).toContain(FX_PAGE_URL);
    expect(harness.loads()).toBe(0);
    expect(harness.writes).toEqual([]);
  });

  it("sends the last persisted rate for /yen without calling the provider", async () => {
    const fxSnapshot = parseFxQuote(
      structuredClone(TWELVE_DATA_EUR_JPY_RESPONSE),
      FX_API_URL,
      "2026-08-20T07:00:00.000Z",
    );
    const harness = createHarness(
      undefined,
      HEALTHY_STATE,
      undefined,
      HEALTHY_STATE,
      fxSnapshot,
    );

    await handleTelegramUpdate(update("/yen"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(text).toContain("1 EUR = 185,4255 JPY");
    expect(text).toContain(FX_PAGE_URL);
    expect(text).not.toContain("TEST EUR/JPY");
    expect(harness.loads()).toBe(0);
    expect(harness.writes).toEqual([]);
  });

  it("fetches a real rate for /test_yen without persisting it", async () => {
    const harness = createHarness();

    await handleTelegramUpdate(update("/test_yen"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(text).toContain("🧪 TEST EUR/JPY");
    expect(text).toContain("appena letto");
    expect(text).toContain("nessuna rilevazione reale");
    expect(text).toContain("1 EUR = 185,4255 JPY");
    expect(harness.loads()).toBe(0);
    expect(harness.fxLoads()).toBe(1);
    expect(harness.writes).toEqual([]);
  });

  it("sets a persistent one-shot EUR/JPY target from comma input", async () => {
    const harness = createHarness();

    await handleTelegramUpdate(
      update("/set_yen 186,5"),
      harness.env,
      harness.deps,
    );

    const targetWrite = harness.writes.find(
      ({ key }) => key === "fx:eurjpy:target:v1",
    );
    expect(targetWrite).toBeDefined();
    expect(JSON.parse(targetWrite!.value)).toEqual({
      schemaVersion: 1,
      threshold: 186.5,
      setAt: NOW,
    });
    expect(harness.fxLoads()).toBe(1);
    expect(harness.messages.join("\n")).toContain(
      "Target EUR/JPY attivato: 186,5000",
    );
    expect(harness.messages.join("\n")).toContain(
      "Cambio attuale: 185,4255",
    );
  });

  it("alerts immediately and clears a target already reached", async () => {
    const harness = createHarness();
    harness.setRawState(
      "fx:eurjpy:target:v1",
      JSON.stringify({
        schemaVersion: 1,
        threshold: 186.5,
        setAt: "2026-08-17T16:00:00.000Z",
      }),
    );

    await handleTelegramUpdate(
      update("/set_yen@scanning_lollo_bot 185.3"),
      harness.env,
      harness.deps,
    );

    const text = harness.messages.join("\n");
    expect(text).toContain("TARGET EUR/JPY RAGGIUNTO");
    expect(text).toContain("Target: 185,3000 JPY");
    expect(text).toContain("Cambio rilevato: 185,4255 JPY");
    expect(text).toContain("Target disattivato automaticamente");
    expect(harness.writes).toEqual([]);
    expect(harness.deletes).toEqual(["fx:eurjpy:target:v1"]);
  });

  it.each(["", "abc", "185,3 extra", "0", "1001"])(
    "rejects an invalid EUR/JPY target without changing state: %j",
    async (value) => {
      const harness = createHarness();

      await handleTelegramUpdate(
        update("/set_yen" + (value ? " " + value : "")),
        harness.env,
        harness.deps,
      );

      expect(harness.writes).toEqual([]);
      expect(harness.deletes).toEqual([]);
      expect(harness.fxLoads()).toBe(0);
      expect(harness.messages.join("\n")).toContain(
        "Uso: /set_yen 185,3",
      );
    },
  );

  it("clears the active EUR/JPY target without calling the provider", async () => {
    const harness = createHarness();
    harness.setRawState(
      "fx:eurjpy:target:v1",
      JSON.stringify({
        schemaVersion: 1,
        threshold: 186.5,
        setAt: NOW,
      }),
    );

    await handleTelegramUpdate(
      update("/clear_yen"),
      harness.env,
      harness.deps,
    );

    expect(harness.deletes).toEqual(["fx:eurjpy:target:v1"]);
    expect(harness.fxLoads()).toBe(0);
    expect(harness.messages.join("\n")).toContain(
      "Target EUR/JPY disattivato",
    );
  });

  it("shows the active EUR/JPY target in the aggregate status", async () => {
    const fxSnapshot = parseFxQuote(
      structuredClone(TWELVE_DATA_EUR_JPY_RESPONSE),
      FX_API_URL,
      "2026-08-20T07:00:00.000Z",
    );
    const harness = createHarness(
      undefined,
      HEALTHY_STATE,
      undefined,
      HEALTHY_STATE,
      fxSnapshot,
      { ...HEALTHY_STATE, lastSuccessAt: fxSnapshot.checkedAt },
    );
    harness.setRawState(
      "fx:eurjpy:target:v1",
      JSON.stringify({
        schemaVersion: 1,
        threshold: 186.5,
        setAt: "2026-08-21T10:00:00.000Z",
      }),
    );

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(text).toContain("Target attivo: 186,5000 JPY");
    expect(text).toContain("Impostato il: 21/08/26, 12:00:00");
  });

  it("keeps a newly set target active when the immediate live check fails", async () => {
    const harness = createHarness();
    const deps: MonitorDependencies = {
      ...harness.deps,
      async loadFxSnapshot() {
        throw new Error("Injected Twelve Data outage");
      },
    };

    await handleTelegramUpdate(
      update("/set_yen 186.5"),
      harness.env,
      deps,
    );

    expect(harness.writes.some(
      ({ key }) => key === "fx:eurjpy:target:v1",
    )).toBe(true);
    const text = harness.messages.join("\n");
    expect(text).toContain("Target EUR/JPY attivato: 186,5000 JPY");
    expect(text).toContain("Verifica immediata non disponibile");
    expect(text).toContain("Il controllo automatico riproverà entro 3 minuti");
    expect(text).not.toContain("comando /set_yen non riuscito");
  });

  it("still reports the other monitors when persisted FX state is invalid", async () => {
    const oakhouseSnapshot = await parseOakhouseHtml(
      BASELINE_HTML,
      URL,
      "2026-08-20T07:00:00.000Z",
    );
    const harness = createHarness(oakhouseSnapshot);
    harness.setRawState(
      FX_SNAPSHOT_KEY,
      JSON.stringify({ schemaVersion: 999, yearLow: 170, yearHigh: 190 }),
    );

    await handleTelegramUpdate(update("/status"), harness.env, harness.deps);

    const text = harness.messages.join("\n");
    expect(text).toContain("✅ GRAN KOBE — monitor operativo");
    expect(text).toContain("⚠️ EUR/JPY — stato non disponibile");
    expect(text).not.toContain("comando /status non riuscito");
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
