import { env as workerEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  runFxMonitor,
  type FxMonitorDependencies,
  type FxMonitorEnv,
} from "../src/fx/monitor";
import {
  FX_HEALTH_KEY,
  FX_SNAPSHOT_KEY,
  type FxSnapshot,
} from "../src/fx/model";
import type { HealthState } from "../src/model";
import { TWELVE_DATA_EUR_JPY_RESPONSE } from "./fixtures/fx";

const env: FxMonitorEnv = {
  STATE: workerEnv.STATE,
  FX_API_URL: "https://api.twelvedata.com/quote",
  FX_PAGE_URL:
    "https://mercati.ilsole24ore.com/tassi-e-valute/valute/contro-euro/cambio/JPYVS.FX",
  TWELVE_DATA_API_KEY: "private-api-key",
  FAILURE_THRESHOLD: "3",
  FETCH_TIMEOUT_MS: "15000",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_CHAT_ID: "123456",
};

interface Harness {
  deps: FxMonitorDependencies;
  messages: string[];
  loads: Array<{ url: string; apiKey: string; timeoutMs: number }>;
  setPayload(value: unknown): void;
  setLoadFailure(value: Error | null): void;
  setSendFailure(value: Error | null): void;
}

function createHarness(nowStepMs = 4 * 60 * 60_000): Harness {
  const messages: string[] = [];
  const loads: Array<{ url: string; apiKey: string; timeoutMs: number }> = [];
  let payload: unknown = structuredClone(TWELVE_DATA_EUR_JPY_RESPONSE);
  let loadFailure: Error | null = null;
  let sendFailure: Error | null = null;
  let now = Date.UTC(2026, 7, 20, 7, 0);

  return {
    messages,
    loads,
    setPayload(value) {
      payload = value;
    },
    setLoadFailure(value) {
      loadFailure = value;
    },
    setSendFailure(value) {
      sendFailure = value;
    },
    deps: {
      async loadQuote(url, apiKey, timeoutMs) {
        loads.push({ url, apiKey, timeoutMs });
        if (loadFailure) {
          throw loadFailure;
        }
        return payload;
      },
      async sendMessages(chunks) {
        if (sendFailure) {
          throw sendFailure;
        }
        messages.push(...chunks);
      },
      now() {
        const checkedAt = new Date(now).toISOString();
        now += nowStepMs;
        return checkedAt;
      },
      log() {},
    },
  };
}

beforeEach(async () => {
  await Promise.all([
    env.STATE.delete(FX_SNAPSHOT_KEY),
    env.STATE.delete(FX_HEALTH_KEY),
    env.STATE.delete("fx:eurjpy:target:v1"),
  ]);
});

describe("runFxMonitor", () => {
  it("checks and persists a rate below target without sending an intermediate digest", async () => {
    const harness = createHarness();
    await env.STATE.put(
      "fx:eurjpy:target:v1",
      JSON.stringify({
        schemaVersion: 1,
        threshold: 186.5,
        setAt: "2026-08-20T06:55:00.000Z",
      }),
    );

    await expect(
      runFxMonitor(env, harness.deps, { sendDigest: false }),
    ).resolves.toMatchObject({
      status: "initialized",
      checkedAt: "2026-08-20T07:00:00.000Z",
    });

    expect(harness.messages).toEqual([]);
    expect(
      await env.STATE.get<FxSnapshot>(FX_SNAPSHOT_KEY, "json"),
    ).toMatchObject({ rate: 185.4255 });
    expect(
      await env.STATE.get("fx:eurjpy:target:v1", "json"),
    ).toMatchObject({ threshold: 186.5 });
  });

  it("polls every three minutes but limits unchanged KV heartbeats to fifteen minutes", async () => {
    const harness = createHarness(3 * 60_000);

    await runFxMonitor(env, harness.deps, { sendDigest: false });
    const second = await runFxMonitor(
      env,
      harness.deps,
      { sendDigest: false },
    );

    expect(harness.loads).toHaveLength(2);
    expect(harness.messages).toEqual([]);
    expect(second).toMatchObject({
      status: "unchanged",
      detail: "FX quote checked without notification",
    });
    expect(
      await env.STATE.get<FxSnapshot>(FX_SNAPSHOT_KEY, "json"),
    ).toMatchObject({ checkedAt: "2026-08-20T07:00:00.000Z" });
    expect(
      await env.STATE.get<HealthState>(FX_HEALTH_KEY, "json"),
    ).toMatchObject({ lastSuccessAt: "2026-08-20T07:00:00.000Z" });
  });

  it("alerts once when a scheduled check reaches the target, then clears it", async () => {
    const harness = createHarness();
    await env.STATE.put(
      "fx:eurjpy:target:v1",
      JSON.stringify({
        schemaVersion: 1,
        threshold: 185.3,
        setAt: "2026-08-20T06:55:00.000Z",
      }),
    );

    await runFxMonitor(env, harness.deps, { sendDigest: false });

    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0]).toContain("TARGET EUR/JPY RAGGIUNTO");
    expect(harness.messages[0]).toContain("Target: 185,3000 JPY");
    expect(harness.messages[0]).toContain("Cambio rilevato: 185,4255 JPY");
    expect(await env.STATE.get("fx:eurjpy:target:v1")).toBeNull();

    harness.messages.length = 0;
    await runFxMonitor(env, harness.deps, { sendDigest: false });
    expect(harness.messages).toEqual([]);
  });

  it("fetches, sends and stores the first scheduled EUR/JPY digest", async () => {
    const harness = createHarness();

    await expect(runFxMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "initialized",
      checkedAt: "2026-08-20T07:00:00.000Z",
    });

    expect(harness.loads).toEqual([{
      url: env.FX_API_URL,
      apiKey: env.TWELVE_DATA_API_KEY,
      timeoutMs: 15_000,
    }]);
    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0]).toContain("1 EUR = 185,4255 JPY");
    expect(harness.messages[0]).toContain(env.FX_PAGE_URL);
    expect(
      await env.STATE.get<FxSnapshot>(FX_SNAPSHOT_KEY, "json"),
    ).toMatchObject({ rate: 185.4255, marketDate: "2026-08-20" });
    expect(
      await env.STATE.get<HealthState>(FX_HEALTH_KEY, "json"),
    ).toMatchObject({
      consecutiveFailures: 0,
      lastSuccessAt: "2026-08-20T07:00:00.000Z",
    });
  });

  it("sends a fresh digest again at the next scheduled slot", async () => {
    const harness = createHarness();
    await runFxMonitor(env, harness.deps);
    harness.messages.length = 0;

    await expect(runFxMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "notified",
      checkedAt: "2026-08-20T11:00:00.000Z",
    });

    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0]).toContain("aggiornamento cambio");
    expect(
      await env.STATE.get<FxSnapshot>(FX_SNAPSHOT_KEY, "json"),
    ).toMatchObject({ checkedAt: "2026-08-20T11:00:00.000Z" });
  });

  it("does not overwrite the last valid rate when Telegram delivery fails", async () => {
    const harness = createHarness();
    await runFxMonitor(env, harness.deps);
    const changed = structuredClone(TWELVE_DATA_EUR_JPY_RESPONSE);
    changed.close = "185.90000";
    changed.high = "186.00000";
    harness.setPayload(changed);
    harness.setSendFailure(new Error("Telegram send failed with HTTP 500"));

    await expect(runFxMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "failed",
    });
    expect(
      await env.STATE.get<FxSnapshot>(FX_SNAPSHOT_KEY, "json"),
    ).toMatchObject({ rate: 185.4255 });
  });

  it("alerts once on the third failure and reports recovery with a digest", async () => {
    const harness = createHarness();
    await runFxMonitor(env, harness.deps);
    harness.messages.length = 0;
    harness.setLoadFailure(new Error("Twelve Data returned HTTP 503"));

    await runFxMonitor(env, harness.deps);
    await runFxMonitor(env, harness.deps);
    expect(harness.messages).toEqual([]);
    await runFxMonitor(env, harness.deps);
    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0]).toContain("3 controlli consecutivi");
    await runFxMonitor(env, harness.deps);
    expect(harness.messages).toHaveLength(1);

    harness.setLoadFailure(null);
    await expect(runFxMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "recovered",
    });
    expect(harness.messages).toHaveLength(3);
    expect(harness.messages[1]).toContain("monitor nuovamente operativo");
    expect(harness.messages[2]).toContain("aggiornamento cambio");
  });
});
