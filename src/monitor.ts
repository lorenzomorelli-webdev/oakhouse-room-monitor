import { diffSnapshots } from "./diff";
import {
  HEALTHY_STATE,
  HEALTH_KEY,
  SNAPSHOT_KEY,
  normalizeText,
  type HealthState,
  type MonitorEnv,
  type Snapshot,
  type SnapshotDiff,
} from "./model";
import {
  formatDiffMessage,
  formatFailureMessage,
  formatInitialMessage,
  formatRecoveryMessage,
  splitTelegramText,
} from "./messages";
import { parseOakhouseHtml } from "./parser";
import { fetchOakhouseHtml } from "./source";
import { parseHealthState, parseSnapshotState } from "./state";
import {
  sendTelegramMessages,
  syncTelegramCommandMenu,
} from "./telegram";

export type RunStatus =
  | "initialized"
  | "notified"
  | "unchanged"
  | "recovered"
  | "failed";

export interface RunResult {
  status: RunStatus;
  checkedAt: string;
  detail: string;
}

export interface MonitorDependencies {
  loadHtml(url: string, timeoutMs: number): Promise<string>;
  sendMessages(messages: string[]): Promise<void>;
  syncCommandMenu?(): Promise<void>;
  now(): string;
  log(event: Record<string, unknown>): void;
}

export type MonitorRunner = (
  env: MonitorEnv,
  deps: MonitorDependencies,
) => Promise<RunResult>;

const HEALTH_HEARTBEAT_MS = 5 * 60 * 1000;
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

function describeError(error: unknown, env: MonitorEnv): string {
  let raw = error instanceof Error ? error.message : "Unknown error";
  for (const secret of [
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

async function readHealth(env: MonitorEnv): Promise<HealthState> {
  const raw = await env.STATE.get(HEALTH_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  if (raw === null) {
    return { ...HEALTHY_STATE };
  }
  try {
    return parseHealthState(JSON.parse(raw));
  } catch {
    throw new Error("Invalid persisted health state");
  }
}

async function readSnapshot(env: MonitorEnv): Promise<Snapshot | null> {
  const raw = await env.STATE.get(SNAPSHOT_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  if (raw === null) {
    return null;
  }
  let snapshot: Snapshot;
  try {
    snapshot = parseSnapshotState(JSON.parse(raw));
  } catch {
    throw new Error("Invalid persisted snapshot");
  }
  if (snapshot.sourceUrl !== env.TARGET_URL) {
    throw new Error("Persisted snapshot belongs to another target");
  }
  return snapshot;
}

async function recordFailure(
  env: MonitorEnv,
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
      event: "health_read_failed",
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

  if (
    mayNotify &&
    next.outageDetected &&
    !next.alertSent
  ) {
    try {
      const text = formatFailureMessage(
        env.PROPERTY_NAME,
        next.consecutiveFailures,
        detail,
        env.ROOMS_URL,
      );
      await deps.sendMessages(splitTelegramText(text));
      next.alertSent = true;
    } catch (notificationError) {
      deps.log({
        level: "error",
        event: "failure_alert_send_failed",
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
      await env.STATE.put(HEALTH_KEY, JSON.stringify(next));
    } catch (healthWriteError) {
      deps.log({
        level: "error",
        event: "health_write_failed",
        error: describeError(healthWriteError, env),
      });
    }
  }

  deps.log({
    level: "error",
    event: "monitor_failed",
    checkedAt,
    consecutiveFailures: next.consecutiveFailures,
    error: detail,
  });
  return { status: "failed", checkedAt, detail };
}

export function createProductionDependencies(
  env: MonitorEnv,
): MonitorDependencies {
  return {
    loadHtml: fetchOakhouseHtml,
    sendMessages(messages) {
      return sendTelegramMessages(
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_CHAT_ID,
        messages,
      );
    },
    syncCommandMenu() {
      return syncTelegramCommandMenu(
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_CHAT_ID,
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

export const runMonitor: MonitorRunner = async (env, deps) => {
  const checkedAt = deps.now();
  let current: Snapshot;
  try {
    const timeoutMs = positiveInteger(
      env.FETCH_TIMEOUT_MS,
      "FETCH_TIMEOUT_MS",
    );
    const html = await deps.loadHtml(env.TARGET_URL, timeoutMs);
    current = await parseOakhouseHtml(html, env.TARGET_URL, checkedAt);
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  let previous: Snapshot | null;
  let health: HealthState;
  try {
    [previous, health] = await Promise.all([
      readSnapshot(env),
      readHealth(env),
    ]);
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  let diff: SnapshotDiff | null;
  let texts: string[];
  try {
    diff = previous ? diffSnapshots(previous, current) : null;
    texts = [];
    if (health.outageDetected) {
      texts.push(formatRecoveryMessage(env.PROPERTY_NAME, env.ROOMS_URL));
    }
    if (previous === null) {
      texts.push(
        formatInitialMessage(current, env.PROPERTY_NAME, env.ROOMS_URL),
      );
    } else if (diff?.hasChanges) {
      texts.push(
        formatDiffMessage(diff, env.PROPERTY_NAME, env.ROOMS_URL),
      );
    }
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
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
      await env.STATE.put(SNAPSHOT_KEY, JSON.stringify(current));
    }
    const recovered =
      health.consecutiveFailures > 0 ||
      health.outageDetected ||
      health.alertSent;
    if (recovered || isHeartbeatDue(health.lastSuccessAt, checkedAt)) {
      await env.STATE.put(
        HEALTH_KEY,
        JSON.stringify({
          ...HEALTHY_STATE,
          lastSuccessAt: checkedAt,
        } satisfies HealthState),
      );
    }
  } catch (error) {
    return recordFailure(env, deps, checkedAt, error, true);
  }

  const status: RunStatus =
    previous === null
      ? "initialized"
      : diff?.hasChanges
        ? "notified"
        : health.outageDetected
          ? "recovered"
          : "unchanged";
  const detail =
    status === "unchanged"
      ? "No availability changes"
      : status === "recovered"
        ? "Monitor recovered"
        : "Snapshot delivered and stored";

  deps.log({
    level: "info",
    event: "monitor_completed",
    status,
    checkedAt,
    parsedRoomCount: current.parsedRoomCount,
    availableRoomCount: current.availableRoomCount,
  });
  return { status, checkedAt, detail };
};
