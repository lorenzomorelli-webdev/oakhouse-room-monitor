import { env as workerEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  HEALTH_KEY,
  SNAPSHOT_KEY,
  type HealthState,
  type MonitorEnv,
  type Snapshot,
} from "../src/model";
import {
  runMonitor,
  type MonitorDependencies,
} from "../src/monitor";
import {
  BASELINE_HTML,
  BASELINE_ROOMS,
  oakhousePage,
} from "./fixtures/oakhouse";

const env: MonitorEnv = {
  STATE: workerEnv.STATE,
  TARGET_URL: "https://www.oakhouse.jp/eng/house/1142",
  ROOMS_URL: "https://www.oakhouse.jp/eng/house/1142#room",
  PROPERTY_NAME: "GRAN KOBE",
  FAILURE_THRESHOLD: "3",
  FETCH_TIMEOUT_MS: "15000",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_CHAT_ID: "123456",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
};

interface Harness {
  deps: MonitorDependencies;
  logs: Record<string, unknown>[];
  messages: string[];
  advanceMinutes(minutes: number): void;
  setHtml(html: string): void;
  setLoadFailure(error: Error | null): void;
  setSendFailure(error: Error | null): void;
}

function createHarness(): Harness {
  let html = BASELINE_HTML;
  let loadFailure: Error | null = null;
  let sendFailure: Error | null = null;
  let now = Date.UTC(2026, 7, 17, 17, 0);
  const logs: Record<string, unknown>[] = [];
  const messages: string[] = [];

  return {
    logs,
    messages,
    advanceMinutes(minutes) {
      now += minutes * 60_000;
    },
    setHtml(value) {
      html = value;
    },
    setLoadFailure(value) {
      loadFailure = value;
    },
    setSendFailure(value) {
      sendFailure = value;
    },
    deps: {
      async loadHtml() {
        if (loadFailure) {
          throw loadFailure;
        }
        return html;
      },
      async sendMessages(chunks) {
        if (sendFailure) {
          throw sendFailure;
        }
        messages.push(...chunks);
      },
      now() {
        const checkedAt = new Date(now).toISOString();
        now += 60_000;
        return checkedAt;
      },
      log(event) {
        logs.push(event);
      },
    },
  };
}

function trackStateOperations(): {
  env: MonitorEnv;
  reads: Array<{ key: string; cacheTtl: number | undefined }>;
  writes: string[];
} {
  const reads: Array<{ key: string; cacheTtl: number | undefined }> = [];
  const keys: string[] = [];
  const state = {
    async get(key: string, options?: { cacheTtl?: number }) {
      reads.push({ key, cacheTtl: options?.cacheTtl });
      return env.STATE.get(key);
    },
    async put(key: string, value: string) {
      keys.push(key);
      await env.STATE.put(key, value);
    },
  } as unknown as KVNamespace;

  return { env: { ...env, STATE: state }, reads, writes: keys };
}

function failOnePut(targetKey: string): MonitorEnv {
  let failed = false;
  const state = {
    get: env.STATE.get.bind(env.STATE),
    async put(key: string, value: string) {
      if (!failed && key === targetKey) {
        failed = true;
        throw new Error("Injected KV put failure for " + key);
      }
      await env.STATE.put(key, value);
    },
  } as unknown as KVNamespace;

  return { ...env, STATE: state };
}

beforeEach(async () => {
  await Promise.all([
    env.STATE.delete(SNAPSHOT_KEY),
    env.STATE.delete(HEALTH_KEY),
  ]);
});

describe("runMonitor", () => {
  it("sends and stores the initial baseline, then stays silent", async () => {
    const harness = createHarness();

    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "initialized",
    });
    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0]).toContain("monitor attivato");
    expect(
      await env.STATE.get<Snapshot>(SNAPSHOT_KEY, "json"),
    ).toMatchObject({ availableRoomCount: 4 });

    harness.messages.length = 0;
    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "unchanged",
    });
    expect(harness.messages).toEqual([]);
  });

  it("persists healthy state only on the five-minute heartbeat", async () => {
    const harness = createHarness();
    const tracked = trackStateOperations();
    await runMonitor(tracked.env, harness.deps);
    tracked.writes.length = 0;

    await runMonitor(tracked.env, harness.deps);
    harness.advanceMinutes(3);
    await runMonitor(tracked.env, harness.deps);

    expect(tracked.writes).toEqual([HEALTH_KEY]);
    expect(
      await env.STATE.get<HealthState>(HEALTH_KEY, "json"),
    ).toMatchObject({ lastSuccessAt: "2026-08-17T17:05:00.000Z" });
  });

  it("uses the shortest KV cache TTL for one-minute polling", async () => {
    const harness = createHarness();
    const tracked = trackStateOperations();

    await runMonitor(tracked.env, harness.deps);

    expect(tracked.reads).toEqual([
      { key: SNAPSHOT_KEY, cacheTtl: 30 },
      { key: HEALTH_KEY, cacheTtl: 30 },
    ]);
  });

  it("sends a diff before advancing the snapshot", async () => {
    const harness = createHarness();
    await runMonitor(env, harness.deps);
    harness.messages.length = 0;

    const changedRooms = BASELINE_ROOMS.map((room) =>
      room.id === "11874"
        ? {
            ...room,
            status: "vacancy" as const,
            availability: "Vacancy",
          }
        : room,
    );
    harness.setHtml(oakhousePage(changedRooms));
    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "notified",
    });

    expect(harness.messages.join("\n")).toContain("➕ Camera 211");
    expect(
      await env.STATE.get<Snapshot>(SNAPSHOT_KEY, "json"),
    ).toMatchObject({ availableRoomCount: 5 });
  });

  it("does not advance the snapshot when Telegram fails", async () => {
    const harness = createHarness();
    await runMonitor(env, harness.deps);

    const changedRooms = BASELINE_ROOMS.map((room) =>
      room.id === "11874"
        ? {
            ...room,
            status: "vacancy" as const,
            availability: "Vacancy",
          }
        : room,
    );
    harness.setHtml(oakhousePage(changedRooms));
    harness.setSendFailure(new Error("Telegram send failed with HTTP 500"));

    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "failed",
    });
    expect(
      await env.STATE.get<Snapshot>(SNAPSHOT_KEY, "json"),
    ).toMatchObject({ availableRoomCount: 4 });

    harness.setSendFailure(null);
    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "notified",
    });
    expect(
      await env.STATE.get<Snapshot>(SNAPSHOT_KEY, "json"),
    ).toMatchObject({ availableRoomCount: 5 });
  });

  it("alerts once on the third failure and once on recovery", async () => {
    const harness = createHarness();
    await runMonitor(env, harness.deps);
    harness.messages.length = 0;
    harness.setLoadFailure(new Error("Oakhouse returned HTTP 503"));

    await runMonitor(env, harness.deps);
    await runMonitor(env, harness.deps);
    expect(harness.messages).toEqual([]);
    await runMonitor(env, harness.deps);
    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0]).toContain("3 controlli consecutivi");
    await runMonitor(env, harness.deps);
    expect(harness.messages).toHaveLength(1);

    harness.setLoadFailure(null);
    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "recovered",
    });
    expect(harness.messages).toHaveLength(2);
    expect(harness.messages[1]).toContain("monitor nuovamente operativo");
    expect(
      await env.STATE.get<HealthState>(HEALTH_KEY, "json"),
    ).toMatchObject({
      consecutiveFailures: 0,
      outageDetected: false,
      alertSent: false,
    });
  });

  it("saturates persistent outage writes at the threshold", async () => {
    const harness = createHarness();
    const tracked = trackStateOperations();
    await runMonitor(tracked.env, harness.deps);
    tracked.writes.length = 0;
    harness.messages.length = 0;
    harness.setLoadFailure(new Error("Oakhouse returned HTTP 503"));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await runMonitor(tracked.env, harness.deps);
    }

    expect(tracked.writes).toEqual([
      HEALTH_KEY,
      HEALTH_KEY,
      HEALTH_KEY,
      HEALTH_KEY,
    ]);
    expect(harness.messages).toHaveLength(1);
    expect(
      await env.STATE.get<HealthState>(HEALTH_KEY, "json"),
    ).toMatchObject({
      consecutiveFailures: 3,
      outageDetected: true,
      alertSent: true,
    });

    harness.advanceMinutes(60);
    await runMonitor(tracked.env, harness.deps);
    expect(tracked.writes).toEqual([
      HEALTH_KEY,
      HEALTH_KEY,
      HEALTH_KEY,
      HEALTH_KEY,
      HEALTH_KEY,
    ]);
  });

  it("preserves the last snapshot when parsing fails", async () => {
    const harness = createHarness();
    await runMonitor(env, harness.deps);
    const before = await env.STATE.get<Snapshot>(SNAPSHOT_KEY, "json");

    harness.setHtml("<html><body>maintenance</body></html>");
    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "failed",
    });

    expect(await env.STATE.get<Snapshot>(SNAPSHOT_KEY, "json")).toEqual(before);
  });

  it("turns an invalid persisted snapshot into a monitored failure", async () => {
    const harness = createHarness();
    await env.STATE.put(SNAPSHOT_KEY, JSON.stringify({ schemaVersion: 99 }));

    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "failed",
      detail: "Invalid persisted snapshot",
    });
    expect(
      await env.STATE.get<HealthState>(HEALTH_KEY, "json"),
    ).toMatchObject({ consecutiveFailures: 1 });
  });

  it("rejects a persisted snapshot from another target", async () => {
    const harness = createHarness();
    await runMonitor(env, harness.deps);
    const snapshot = await env.STATE.get<Snapshot>(SNAPSHOT_KEY, "json");
    await env.STATE.put(
      SNAPSHOT_KEY,
      JSON.stringify({
        ...snapshot,
        sourceUrl: "https://example.com/another-property",
      }),
    );

    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "failed",
      detail: "Persisted snapshot belongs to another target",
    });
  });

  it("reports recovery after a threshold-length Telegram outage", async () => {
    const harness = createHarness();
    await runMonitor(env, harness.deps);
    harness.messages.length = 0;

    const changedRooms = BASELINE_ROOMS.map((room) =>
      room.id === "11874"
        ? {
            ...room,
            status: "vacancy" as const,
            availability: "Vacancy",
          }
        : room,
    );
    harness.setHtml(oakhousePage(changedRooms));
    harness.setSendFailure(new Error("Telegram request failed"));

    await runMonitor(env, harness.deps);
    await runMonitor(env, harness.deps);
    await runMonitor(env, harness.deps);
    expect(
      await env.STATE.get<HealthState>(HEALTH_KEY, "json"),
    ).toMatchObject({
      consecutiveFailures: 3,
      outageDetected: true,
      alertSent: false,
    });

    harness.setSendFailure(null);
    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "notified",
    });
    expect(harness.messages.join("\n")).toContain(
      "monitor nuovamente operativo",
    );
    expect(harness.messages.join("\n")).toContain("➕ Camera 211");
  });

  it("redacts exact secret values from state and logs", async () => {
    const harness = createHarness();
    harness.setLoadFailure(new Error(
      "request contained " +
        env.TELEGRAM_BOT_TOKEN +
        " for chat " +
        env.TELEGRAM_CHAT_ID,
    ));

    await runMonitor(env, harness.deps);

    const health = await env.STATE.get<HealthState>(HEALTH_KEY, "json");
    const diagnosticText = JSON.stringify({ health, logs: harness.logs });
    expect(diagnosticText).not.toContain(env.TELEGRAM_BOT_TOKEN);
    expect(diagnosticText).not.toContain(env.TELEGRAM_CHAT_ID);
    expect(diagnosticText).toContain("[redacted]");
  });

  it("retries delivery when the snapshot write fails", async () => {
    const harness = createHarness();

    await expect(
      runMonitor(failOnePut(SNAPSHOT_KEY), harness.deps),
    ).resolves.toMatchObject({ status: "failed" });
    expect(harness.messages).toHaveLength(1);
    expect(await env.STATE.get(SNAPSHOT_KEY)).toBeNull();
    expect(
      await env.STATE.get<HealthState>(HEALTH_KEY, "json"),
    ).toMatchObject({ consecutiveFailures: 1 });

    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "initialized",
    });
    expect(harness.messages).toHaveLength(2);
  });

  it("does not redeliver after only the health write fails", async () => {
    const harness = createHarness();

    await expect(
      runMonitor(failOnePut(HEALTH_KEY), harness.deps),
    ).resolves.toMatchObject({ status: "failed" });
    expect(harness.messages).toHaveLength(1);
    expect(
      await env.STATE.get<Snapshot>(SNAPSHOT_KEY, "json"),
    ).toMatchObject({ availableRoomCount: 4 });

    harness.messages.length = 0;
    await expect(runMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "unchanged",
    });
    expect(harness.messages).toEqual([]);
  });
});
