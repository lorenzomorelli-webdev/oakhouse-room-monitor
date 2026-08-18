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
import type { MonitorDependencies, RunResult } from "../monitor";
import { parseHealthState } from "../state";
import { sendTelegramMessages } from "../telegram";
import { diffAyntecSnapshots } from "./diff";
import {
  formatAyntecDiffMessage,
  formatAyntecInitialMessage,
} from "./messages";
import type { AyntecSnapshot } from "./model";
import { parseAyntecHtml } from "./parser";
import { fetchAyntecHtml } from "./source";
import { parseAyntecSnapshotState } from "./state";

export const AYNTEC_SNAPSHOT_KEY = "ayntec:shipment-dashboard:snapshot:v1";
export const AYNTEC_HEALTH_KEY = "ayntec:shipment-dashboard:health:v1";

export interface AyntecMonitorEnv {
  STATE: KVNamespace;
  AYN_TARGET_URL: string;
  AYN_DASHBOARD_URL: string;
  FAILURE_THRESHOLD: string;
  FETCH_TIMEOUT_MS: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export type AyntecMonitorRunner = (
  env: AyntecMonitorEnv,
  deps: MonitorDependencies,
) => Promise<RunResult>;

const MONITOR_NAME = "AYN Shipping Dashboard";
const HEALTH_HEARTBEAT_MS = 30 * 60 * 1000;
const STATE_CACHE_TTL_SECONDS = 30;

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(name + " must be a positive integer");
  }
  return parsed;
}

function isHeartbeatDue(
  previousTimestamp: string | null,
  checkedAt: string,
): boolean {
  if (previousTimestamp === null) {
    return true;
  }
  const previous = Date.parse(previousTimestamp);
  const current = Date.parse(checkedAt);
  return (
    !Number.isFinite(previous) ||
    !Number.isFinite(current) ||
    current < previous ||
    current - previous >= HEALTH_HEARTBEAT_MS
  );
}

function describeError(error: unknown, env: AyntecMonitorEnv): string {
  let raw = error instanceof Error ? error.message : "Unknown error";
  for (const secret of [env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID]) {
    if (secret) {
      raw = raw.replaceAll(secret, "[redacted]");
    }
  }
  return normalizeText(raw)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .slice(0, 160);
}

async function readSnapshot(
  env: AyntecMonitorEnv,
): Promise<AyntecSnapshot | null> {
  const raw = await env.STATE.get(AYNTEC_SNAPSHOT_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  if (raw === null) {
    return null;
  }
  const snapshot = parseAyntecSnapshotState(JSON.parse(raw));
  if (snapshot.sourceUrl !== env.AYN_TARGET_URL) {
    throw new Error("Persisted AYN snapshot belongs to another target");
  }
  return snapshot;
}

async function readHealth(env: AyntecMonitorEnv): Promise<HealthState> {
  const raw = await env.STATE.get(AYNTEC_HEALTH_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  return raw === null
    ? { ...HEALTHY_STATE }
    : parseHealthState(JSON.parse(raw));
}

async function recordFailure(
  env: AyntecMonitorEnv,
  deps: MonitorDependencies,
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
      event: "ayntec_health_read_failed",
      error: describeError(healthReadError, env),
    });
  }

  const threshold = positiveInteger(
    env.FAILURE_THRESHOLD,
    "FAILURE_THRESHOLD",
  );
  const next: HealthState = {
    ...previous,
    consecutiveFailures: Math.min(
      previous.consecutiveFailures + 1,
      threshold,
    ),
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
        env.AYN_DASHBOARD_URL,
      )));
      next.alertSent = true;
    } catch (notificationError) {
      deps.log({
        level: "error",
        event: "ayntec_failure_alert_send_failed",
        error: describeError(notificationError, env),
      });
    }
  }

  const stateChanged =
    next.consecutiveFailures !== previous.consecutiveFailures ||
    next.outageDetected !== previous.outageDetected ||
    next.alertSent !== previous.alertSent;
  if (stateChanged || isHeartbeatDue(previous.lastErrorAt, checkedAt)) {
    try {
      await env.STATE.put(AYNTEC_HEALTH_KEY, JSON.stringify(next));
    } catch (healthWriteError) {
      deps.log({
        level: "error",
        event: "ayntec_health_write_failed",
        error: describeError(healthWriteError, env),
      });
    }
  }

  deps.log({
    level: "error",
    event: "ayntec_monitor_failed",
    checkedAt,
    consecutiveFailures: next.consecutiveFailures,
    error: detail,
  });
  return { status: "failed", checkedAt, detail };
}

export function createAyntecProductionDependencies(
  env: AyntecMonitorEnv,
): MonitorDependencies {
  return {
    loadHtml: fetchAyntecHtml,
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

export const runAyntecMonitor: AyntecMonitorRunner = async (env, deps) => {
  const checkedAt = deps.now();
  let current: AyntecSnapshot;
  try {
    const timeoutMs = positiveInteger(
      env.FETCH_TIMEOUT_MS,
      "FETCH_TIMEOUT_MS",
    );
    const html = await deps.loadHtml(env.AYN_TARGET_URL, timeoutMs);
    current = await parseAyntecHtml(html, env.AYN_TARGET_URL, checkedAt);
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  let previous: AyntecSnapshot | null;
  let health: HealthState;
  try {
    [previous, health] = await Promise.all([
      readSnapshot(env),
      readHealth(env),
    ]);
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  const diff = previous ? diffAyntecSnapshots(previous, current) : null;
  const texts: string[] = [];
  if (health.outageDetected) {
    texts.push(formatRecoveryMessage(MONITOR_NAME, env.AYN_DASHBOARD_URL));
  }
  if (previous === null) {
    texts.push(formatAyntecInitialMessage(current, env.AYN_DASHBOARD_URL));
  } else if (diff?.hasChanges) {
    texts.push(formatAyntecDiffMessage(diff, env.AYN_DASHBOARD_URL));
  }

  try {
    if (texts.length > 0) {
      await deps.sendMessages(
        texts.flatMap((text) => splitTelegramText(text)),
      );
    }
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, false);
  }

  try {
    if (previous === null || diff?.hasChanges) {
      await env.STATE.put(AYNTEC_SNAPSHOT_KEY, JSON.stringify(current));
    }
    const recovered =
      health.consecutiveFailures > 0 ||
      health.outageDetected ||
      health.alertSent;
    if (recovered || isHeartbeatDue(health.lastSuccessAt, checkedAt)) {
      await env.STATE.put(
        AYNTEC_HEALTH_KEY,
        JSON.stringify({
          ...HEALTHY_STATE,
          lastSuccessAt: checkedAt,
        } satisfies HealthState),
      );
    }
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  const status = previous === null
    ? "initialized"
    : diff?.hasChanges
      ? "notified"
      : health.outageDetected
        ? "recovered"
        : "unchanged";
  const detail = status === "unchanged"
    ? "No AYN shipment changes"
    : status === "recovered"
      ? "AYN monitor recovered"
      : "AYN snapshot delivered and stored";
  deps.log({
    level: "info",
    event: "ayntec_monitor_completed",
    status,
    checkedAt,
    entryCount: current.entryCount,
    latestDate: current.latestDate,
  });
  return { status, checkedAt, detail };
};
