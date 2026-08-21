import {
  formatFailureMessage,
  formatRecoveryMessage,
  splitTelegramText,
} from "../messages";
import {
  HEALTHY_STATE,
  normalizeText,
  type HealthState,
} from "../model";
import type { RunResult } from "../monitor";
import { parseHealthState } from "../state";
import { sendTelegramMessages } from "../telegram";
import { formatFxDigestMessage } from "./messages";
import {
  FX_HEALTH_KEY,
  FX_SNAPSHOT_KEY,
  type FxSnapshot,
} from "./model";
import { parseFxQuote } from "./parser";
import { fetchFxQuote } from "./source";
import { parseFxSnapshotState } from "./state";

export interface FxMonitorEnv {
  STATE: KVNamespace;
  FX_API_URL: string;
  FX_PAGE_URL: string;
  TWELVE_DATA_API_KEY: string;
  FAILURE_THRESHOLD: string;
  FETCH_TIMEOUT_MS: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export interface FxMonitorDependencies {
  loadQuote(
    apiUrl: string,
    apiKey: string,
    timeoutMs: number,
  ): Promise<unknown>;
  sendMessages(messages: string[]): Promise<void>;
  now(): string;
  log(event: Record<string, unknown>): void;
}

export type FxMonitorRunner = (
  env: FxMonitorEnv,
  deps: FxMonitorDependencies,
) => Promise<RunResult>;

const MONITOR_NAME = "EUR/JPY";
const STATE_CACHE_TTL_SECONDS = 30;

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(name + " must be a positive integer");
  }
  return parsed;
}

function describeError(error: unknown, env: FxMonitorEnv): string {
  let raw = error instanceof Error ? error.message : "Unknown error";
  for (const secret of [
    env.TWELVE_DATA_API_KEY,
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_CHAT_ID,
  ]) {
    if (secret) {
      raw = raw.replaceAll(secret, "[redacted]");
    }
  }
  return normalizeText(raw)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .slice(0, 160);
}

async function readSnapshot(env: FxMonitorEnv): Promise<FxSnapshot | null> {
  const raw = await env.STATE.get(FX_SNAPSHOT_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  if (raw === null) {
    return null;
  }
  const snapshot = parseFxSnapshotState(JSON.parse(raw));
  if (snapshot.sourceUrl !== env.FX_API_URL) {
    throw new Error("Persisted FX snapshot belongs to another source");
  }
  return snapshot;
}

async function readHealth(env: FxMonitorEnv): Promise<HealthState> {
  const raw = await env.STATE.get(FX_HEALTH_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  return raw === null
    ? { ...HEALTHY_STATE }
    : parseHealthState(JSON.parse(raw));
}

async function recordFailure(
  env: FxMonitorEnv,
  deps: FxMonitorDependencies,
  checkedAt: string,
  error: unknown,
  mayNotify: boolean,
): Promise<RunResult> {
  const detail = describeError(error, env);
  let previous: HealthState = { ...HEALTHY_STATE };
  try {
    previous = await readHealth(env);
  } catch (healthReadError) {
    deps.log({
      level: "error",
      event: "fx_health_read_failed",
      error: describeError(healthReadError, env),
    });
  }

  const threshold = positiveInteger(
    env.FAILURE_THRESHOLD,
    "FAILURE_THRESHOLD",
  );
  const next: HealthState = {
    ...previous,
    consecutiveFailures: Math.min(previous.consecutiveFailures + 1, threshold),
    lastErrorAt: checkedAt,
    lastError: detail,
  };
  next.outageDetected =
    previous.outageDetected || next.consecutiveFailures >= threshold;

  if (mayNotify && next.outageDetected && !next.alertSent) {
    try {
      await deps.sendMessages(splitTelegramText(formatFailureMessage(
        MONITOR_NAME,
        next.consecutiveFailures,
        detail,
        env.FX_PAGE_URL,
      )));
      next.alertSent = true;
    } catch (notificationError) {
      deps.log({
        level: "error",
        event: "fx_failure_alert_send_failed",
        error: describeError(notificationError, env),
      });
    }
  }

  try {
    await env.STATE.put(FX_HEALTH_KEY, JSON.stringify(next));
  } catch (healthWriteError) {
    deps.log({
      level: "error",
      event: "fx_health_write_failed",
      error: describeError(healthWriteError, env),
    });
  }

  deps.log({
    level: "error",
    event: "fx_monitor_failed",
    checkedAt,
    consecutiveFailures: next.consecutiveFailures,
    error: detail,
  });
  return { status: "failed", checkedAt, detail };
}

export function createFxProductionDependencies(
  env: FxMonitorEnv,
): FxMonitorDependencies {
  return {
    loadQuote: fetchFxQuote,
    sendMessages(messages) {
      return sendTelegramMessages(
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_CHAT_ID,
        messages,
      );
    },
    now() {
      return new Date().toISOString();
    },
    log(event) {
      console.log(JSON.stringify(event));
    },
  };
}

export const runFxMonitor: FxMonitorRunner = async (env, deps) => {
  const checkedAt = deps.now();
  let current: FxSnapshot;
  try {
    if (!env.TWELVE_DATA_API_KEY.trim()) {
      throw new Error("TWELVE_DATA_API_KEY is required");
    }
    const timeoutMs = positiveInteger(
      env.FETCH_TIMEOUT_MS,
      "FETCH_TIMEOUT_MS",
    );
    const payload = await deps.loadQuote(
      env.FX_API_URL,
      env.TWELVE_DATA_API_KEY,
      timeoutMs,
    );
    current = parseFxQuote(payload, env.FX_API_URL, checkedAt);
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  let previous: FxSnapshot | null;
  let health: HealthState;
  try {
    [previous, health] = await Promise.all([
      readSnapshot(env),
      readHealth(env),
    ]);
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  const texts: string[] = [];
  if (health.outageDetected) {
    texts.push(formatRecoveryMessage(MONITOR_NAME, env.FX_PAGE_URL));
  }
  texts.push(formatFxDigestMessage(current, env.FX_PAGE_URL));

  try {
    await deps.sendMessages(
      texts.flatMap((text) => splitTelegramText(text)),
    );
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, false);
  }

  try {
    await Promise.all([
      env.STATE.put(FX_SNAPSHOT_KEY, JSON.stringify(current)),
      env.STATE.put(
        FX_HEALTH_KEY,
        JSON.stringify({
          ...HEALTHY_STATE,
          lastSuccessAt: checkedAt,
        } satisfies HealthState),
      ),
    ]);
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  const status = health.outageDetected
    ? "recovered"
    : previous === null
      ? "initialized"
      : "notified";
  deps.log({
    level: "info",
    event: "fx_monitor_completed",
    status,
    checkedAt,
    marketDate: current.marketDate,
    rate: current.rate,
  });
  return {
    status,
    checkedAt,
    detail: status === "recovered"
      ? "FX monitor recovered and digest delivered"
      : "FX digest delivered and stored",
  };
};
