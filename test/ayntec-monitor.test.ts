import { env as workerEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { MonitorDependencies } from "../src/monitor";
import {
  AYNTEC_HEALTH_KEY,
  AYNTEC_SNAPSHOT_KEY,
  runAyntecMonitor,
  type AyntecMonitorEnv,
} from "../src/ayntec/monitor";
import type { AyntecSnapshot } from "../src/ayntec/model";
import type { HealthState } from "../src/model";
import { AYNTEC_DASHBOARD_HTML } from "./fixtures/ayntec";

const env: AyntecMonitorEnv = {
  STATE: workerEnv.STATE,
  AYN_TARGET_URL:
    "https://www.ayntec.com/pages/shipment-dashboard?section_id=main-page",
  AYN_DASHBOARD_URL: "https://www.ayntec.com/pages/shipment-dashboard",
  FAILURE_THRESHOLD: "3",
  FETCH_TIMEOUT_MS: "15000",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_CHAT_ID: "123456",
};

interface Harness {
  deps: MonitorDependencies;
  messages: string[];
  setHtml(html: string): void;
  setLoadFailure(error: Error | null): void;
  setSendFailure(error: Error | null): void;
}

function createHarness(): Harness {
  const messages: string[] = [];
  let html = AYNTEC_DASHBOARD_HTML;
  let loadFailure: Error | null = null;
  let sendFailure: Error | null = null;
  let now = Date.UTC(2026, 7, 18, 16, 0);
  return {
    messages,
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
        now += 30 * 60_000;
        return checkedAt;
      },
      log() {},
    },
  };
}

function withNewShipmentDay(html = AYNTEC_DASHBOARD_HTML): string {
  return html.replace(
    "  </div>\n</div>",
    [
      "    <p><strong>2026/8/18</strong></p>",
      "    <p>AYN Thor White Pro: 3001xx--3020xx</p>",
      "    <p>AYN Thor White Max: 3021xx--3040xx</p>",
      "  </div>",
      "</div>",
    ].join("\n"),
  );
}

beforeEach(async () => {
  await Promise.all([
    env.STATE.delete(AYNTEC_SNAPSHOT_KEY),
    env.STATE.delete(AYNTEC_HEALTH_KEY),
  ]);
});

describe("runAyntecMonitor", () => {
  it("sends and stores the initial baseline, then stays silent", async () => {
    const harness = createHarness();

    await expect(runAyntecMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "initialized",
    });
    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0]).toContain("monitor attivato");
    expect(
      await env.STATE.get<AyntecSnapshot>(AYNTEC_SNAPSHOT_KEY, "json"),
    ).toMatchObject({ entryCount: 5, latestDate: "2026-08-17" });

    harness.messages.length = 0;
    await expect(runAyntecMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "unchanged",
    });
    expect(harness.messages).toEqual([]);
  });

  it("refreshes the success heartbeat on every 30-minute run", async () => {
    const harness = createHarness();

    await runAyntecMonitor(env, harness.deps);
    expect(
      await env.STATE.get<HealthState>(AYNTEC_HEALTH_KEY, "json"),
    ).toMatchObject({ lastSuccessAt: "2026-08-18T16:00:00.000Z" });

    await runAyntecMonitor(env, harness.deps);
    expect(
      await env.STATE.get<HealthState>(AYNTEC_HEALTH_KEY, "json"),
    ).toMatchObject({ lastSuccessAt: "2026-08-18T16:30:00.000Z" });
  });

  it("stores same-day shipment corrections without notifying", async () => {
    const harness = createHarness();
    await runAyntecMonitor(env, harness.deps);
    harness.messages.length = 0;
    harness.setHtml(
      AYNTEC_DASHBOARD_HTML.replace("2472xx--2600xx", "2472xx--2620xx"),
    );

    await expect(runAyntecMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "unchanged",
    });

    expect(harness.messages).toEqual([]);
    expect(
      await env.STATE.get<AyntecSnapshot>(AYNTEC_SNAPSHOT_KEY, "json"),
    ).toMatchObject({
      entries: {
        "2026-08-17|ayn thor rainbow max(512)": {
          details: "2472xx--2620xx",
        },
      },
    });
  });

  it("stores a new same-day row without notifying", async () => {
    const harness = createHarness();
    await runAyntecMonitor(env, harness.deps);
    harness.messages.length = 0;
    harness.setHtml(
      AYNTEC_DASHBOARD_HTML.replace(
        "    <p>AYN Thor Rainbow Max（512）: 2472xx--2600xx</p>",
        [
          "    <p>AYN Thor Rainbow Max（512）: 2472xx--2600xx</p>",
          "    <p>AYN Thor White Pro: 3001xx--3020xx</p>",
        ].join("\n"),
      ),
    );

    await expect(runAyntecMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "unchanged",
    });

    expect(harness.messages).toEqual([]);
    expect(
      await env.STATE.get<AyntecSnapshot>(AYNTEC_SNAPSHOT_KEY, "json"),
    ).toMatchObject({
      latestDate: "2026-08-17",
      entryCount: 6,
    });
  });

  it("notifies when a later shipment day is published", async () => {
    const harness = createHarness();
    await runAyntecMonitor(env, harness.deps);
    harness.messages.length = 0;
    harness.setHtml(withNewShipmentDay());

    await expect(runAyntecMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "notified",
    });

    const text = harness.messages.join("\n");
    expect(text).toContain("nuovo batch pubblicato");
    expect(text).toContain("18/08/2026");
    expect(text).toContain("AYN Thor White Pro — 3001xx--3020xx");
    expect(text).toContain("AYN Thor White Max — 3021xx--3040xx");
  });

  it("does not advance the AYN snapshot when Telegram delivery fails", async () => {
    const harness = createHarness();
    await runAyntecMonitor(env, harness.deps);
    harness.setHtml(withNewShipmentDay());
    harness.setSendFailure(new Error("Telegram send failed with HTTP 500"));

    await expect(runAyntecMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "failed",
    });
    expect(
      await env.STATE.get<AyntecSnapshot>(AYNTEC_SNAPSHOT_KEY, "json"),
    ).toMatchObject({
      latestDate: "2026-08-17",
    });

    harness.setSendFailure(null);
    await expect(runAyntecMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "notified",
    });
    expect(
      await env.STATE.get<AyntecSnapshot>(AYNTEC_SNAPSHOT_KEY, "json"),
    ).toMatchObject({ latestDate: "2026-08-18" });
  });

  it("alerts once on the third AYN failure and once on recovery", async () => {
    const harness = createHarness();
    await runAyntecMonitor(env, harness.deps);
    harness.messages.length = 0;
    harness.setLoadFailure(new Error("AYN returned HTTP 503"));

    await runAyntecMonitor(env, harness.deps);
    await runAyntecMonitor(env, harness.deps);
    expect(harness.messages).toEqual([]);
    await runAyntecMonitor(env, harness.deps);
    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0]).toContain("3 controlli consecutivi");
    await runAyntecMonitor(env, harness.deps);
    expect(harness.messages).toHaveLength(1);

    harness.setLoadFailure(null);
    await expect(runAyntecMonitor(env, harness.deps)).resolves.toMatchObject({
      status: "recovered",
    });
    expect(harness.messages).toHaveLength(2);
    expect(harness.messages[1]).toContain("monitor nuovamente operativo");
    expect(
      await env.STATE.get<HealthState>(AYNTEC_HEALTH_KEY, "json"),
    ).toMatchObject({
      consecutiveFailures: 0,
      outageDetected: false,
      alertSent: false,
    });
  });
});
