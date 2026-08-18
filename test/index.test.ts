import { env as workerEnv } from "cloudflare:workers";
import {
  createExecutionContext,
  createScheduledController,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createWorker } from "../src/index";
import type { AyntecMonitorRunner } from "../src/ayntec/monitor";
import type { MonitorEnv, WorkerEnv } from "../src/model";
import type {
  MonitorDependencies,
  MonitorRunner,
} from "../src/monitor";

const env: WorkerEnv = {
  STATE: workerEnv.STATE,
  TARGET_URL: "https://www.oakhouse.jp/eng/house/1142",
  ROOMS_URL: "https://www.oakhouse.jp/eng/house/1142#room",
  PROPERTY_NAME: "GRAN KOBE",
  AYN_TARGET_URL:
    "https://www.ayntec.com/pages/shipment-dashboard?section_id=main-page",
  AYN_DASHBOARD_URL: "https://www.ayntec.com/pages/shipment-dashboard",
  FAILURE_THRESHOLD: "3",
  FETCH_TIMEOUT_MS: "15000",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_CHAT_ID: "123456",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
};

describe("scheduled Worker entry point", () => {
  it("delegates one Cron event to the monitor runner", async () => {
    const received: MonitorEnv[] = [];
    const runner: MonitorRunner = async (receivedEnv) => {
      received.push(receivedEnv);
      return {
        status: "unchanged",
        checkedAt: "2026-08-17T17:03:00.000Z",
        detail: "No availability changes",
      };
    };
    const dependencies: MonitorDependencies = {
      async loadHtml() {
        return "";
      },
      async sendMessages() {},
      now() {
        return "2026-08-17T17:03:00.000Z";
      },
      log() {},
    };
    const worker = createWorker(runner, () => dependencies);
    const controller = createScheduledController({
      scheduledTime: new Date("2026-08-17T17:03:00.000Z"),
      cron: "* * * * *",
    });

    await worker.scheduled(
      controller,
      env,
      createExecutionContext(),
    );

    expect(received).toEqual([env]);
  });

  it("routes the 30-minute Cron exclusively to the AYN monitor", async () => {
    const oakhouseRuns: MonitorEnv[] = [];
    const ayntecRuns: WorkerEnv[] = [];
    const oakhouseRunner: MonitorRunner = async (receivedEnv) => {
      oakhouseRuns.push(receivedEnv);
      return {
        status: "unchanged",
        checkedAt: "2026-08-17T17:30:00.000Z",
        detail: "No availability changes",
      };
    };
    const ayntecRunner: AyntecMonitorRunner = async (receivedEnv) => {
      ayntecRuns.push(receivedEnv as WorkerEnv);
      return {
        status: "unchanged",
        checkedAt: "2026-08-17T17:30:00.000Z",
        detail: "No AYN shipment changes",
      };
    };
    const dependencies: MonitorDependencies = {
      async loadHtml() {
        return "";
      },
      async sendMessages() {},
      now() {
        return "2026-08-17T17:30:00.000Z";
      },
      log() {},
    };
    const worker = createWorker(
      oakhouseRunner,
      () => dependencies,
      async () => {},
      ayntecRunner,
      () => dependencies,
    );

    await worker.scheduled(
      createScheduledController({
        scheduledTime: new Date("2026-08-17T17:30:00.000Z"),
        cron: "*/30 * * * *",
      }),
      env,
      createExecutionContext(),
    );

    expect(oakhouseRuns).toEqual([]);
    expect(ayntecRuns).toEqual([env]);
  });

  it("does not run either monitor for an unknown Cron expression", async () => {
    let oakhouseRuns = 0;
    let ayntecRuns = 0;
    const dependencies: MonitorDependencies = {
      async loadHtml() {
        return "";
      },
      async sendMessages() {},
      now() {
        return "2026-08-17T18:00:00.000Z";
      },
      log() {},
    };
    const worker = createWorker(
      async () => {
        oakhouseRuns += 1;
        return {
          status: "unchanged",
          checkedAt: "2026-08-17T18:00:00.000Z",
          detail: "No availability changes",
        };
      },
      () => dependencies,
      async () => {},
      async () => {
        ayntecRuns += 1;
        return {
          status: "unchanged",
          checkedAt: "2026-08-17T18:00:00.000Z",
          detail: "No AYN shipment changes",
        };
      },
      () => dependencies,
    );

    await worker.scheduled(
      createScheduledController({
        scheduledTime: new Date("2026-08-17T18:00:00.000Z"),
        cron: "0 * * * *",
      }),
      env,
      createExecutionContext(),
    );

    expect(oakhouseRuns).toBe(0);
    expect(ayntecRuns).toBe(0);
  });
});

describe("Telegram webhook entry point", () => {
  const dependencies: MonitorDependencies = {
    async loadHtml() {
      return "";
    },
    async sendMessages() {},
    now() {
      return "2026-08-17T17:03:00.000Z";
    },
    log() {},
  };
  const runner: MonitorRunner = async () => ({
    status: "unchanged",
    checkedAt: "2026-08-17T17:03:00.000Z",
    detail: "No availability changes",
  });

  it("accepts an authenticated Telegram update in the background", async () => {
    const updates: unknown[] = [];
    const worker = createWorker(
      runner,
      () => dependencies,
      async (update) => {
        updates.push(update);
      },
    );
    const payload = { update_id: 123, message: { text: "/status" } };
    const context = createExecutionContext();

    const response = await worker.fetch(
      new Request("https://worker.example/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "webhook-secret",
        },
        body: JSON.stringify(payload),
      }),
      env,
      context,
    );
    expect(response.status).toBe(204);
    expect(updates).toEqual([payload]);
  });

  it("rejects requests with the wrong webhook secret", async () => {
    const updates: unknown[] = [];
    const worker = createWorker(
      runner,
      () => dependencies,
      async (update) => {
        updates.push(update);
      },
    );

    const response = await worker.fetch(
      new Request("https://worker.example/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "wrong-secret",
        },
        body: JSON.stringify({ update_id: 123 }),
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it("returns a retryable error when command processing rejects", async () => {
    const worker = createWorker(
      runner,
      () => dependencies,
      async () => {
        throw new Error("Injected command failure");
      },
    );
    const context = createExecutionContext();

    const response = await worker.fetch(
      new Request("https://worker.example/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "webhook-secret",
        },
        body: JSON.stringify({ update_id: 123 }),
      }),
      env,
      context,
    );
    expect(response.status).toBe(502);
  });

  it("rejects malformed payloads and unrelated routes", async () => {
    const worker = createWorker(runner, () => dependencies, async () => {});
    const headers = {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "webhook-secret",
    };

    const malformed = await worker.fetch(
      new Request("https://worker.example/telegram/webhook", {
        method: "POST",
        headers,
        body: "not-json",
      }),
      env,
      createExecutionContext(),
    );
    const unrelated = await worker.fetch(
      new Request("https://worker.example/anything-else"),
      env,
      createExecutionContext(),
    );

    expect(malformed.status).toBe(400);
    expect(unrelated.status).toBe(404);
  });
});
