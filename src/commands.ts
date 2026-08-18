import { diffAyntecSnapshots } from "./ayntec/diff";
import {
  formatAyntecStatusMessage,
  formatAyntecSyntheticTestMessage,
} from "./ayntec/messages";
import {
  AYNTEC_HEALTH_KEY,
  AYNTEC_SNAPSHOT_KEY,
} from "./ayntec/monitor";
import type {
  AyntecSnapshot,
  AyntecSnapshotDiff,
} from "./ayntec/model";
import { parseAyntecSnapshotState } from "./ayntec/state";
import { diffSnapshots } from "./diff";
import {
  AVAILABLE_STATUS,
  HEALTHY_STATE,
  HEALTH_KEY,
  SNAPSHOT_KEY,
  UNAVAILABLE_STATUS,
  compareRoomNumbers,
  getAvailableRoomIds,
  type HealthState,
  type Snapshot,
  type SnapshotDiff,
  type WorkerEnv,
} from "./model";
import {
  formatCommandFailure,
  formatCommandGuide,
  formatStatusMessage,
  formatSyntheticTestMessage,
  splitTelegramText,
} from "./messages";
import type { MonitorDependencies } from "./monitor";
import { parseHealthState, parseSnapshotState } from "./state";

const STATE_CACHE_TTL_SECONDS = 30;

interface TelegramMessage {
  chatId: string;
  chatType: string;
  text: string;
}

type TelegramCommand =
  | "/start"
  | "/help"
  | "/status"
  | "/test"
  | "/test_ayntec"
  | "/unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTelegramMessage(update: unknown): TelegramMessage | null {
  if (!isRecord(update) || !isRecord(update.message)) {
    return null;
  }
  const message = update.message;
  if (!isRecord(message.chat) || typeof message.text !== "string") {
    return null;
  }
  const chatId = message.chat.id;
  const chatType = message.chat.type;
  if (
    (typeof chatId !== "number" && typeof chatId !== "string") ||
    typeof chatType !== "string"
  ) {
    return null;
  }
  return { chatId: String(chatId), chatType, text: message.text };
}

function parseCommand(text: string): TelegramCommand {
  const firstToken = text.trim().split(/\s+/, 1)[0] ?? "";
  const command = firstToken.split("@", 1)[0].toLowerCase();
  return [
    "/start",
    "/help",
    "/status",
    "/test",
    "/test_ayntec",
  ].includes(command)
    ? command as TelegramCommand
    : "/unknown";
}

async function readSnapshot(env: WorkerEnv): Promise<Snapshot | null> {
  const raw = await env.STATE.get(SNAPSHOT_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  if (raw === null) {
    return null;
  }
  const snapshot = parseSnapshotState(JSON.parse(raw));
  if (snapshot.sourceUrl !== env.TARGET_URL) {
    throw new Error("Persisted snapshot belongs to another target");
  }
  return snapshot;
}

async function readHealth(env: WorkerEnv): Promise<HealthState> {
  const raw = await env.STATE.get(HEALTH_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  return raw === null
    ? { ...HEALTHY_STATE }
    : parseHealthState(JSON.parse(raw));
}

async function readAyntecSnapshot(
  env: WorkerEnv,
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

async function readAyntecHealth(env: WorkerEnv): Promise<HealthState> {
  const raw = await env.STATE.get(AYNTEC_HEALTH_KEY, {
    cacheTtl: STATE_CACHE_TTL_SECONDS,
  });
  return raw === null
    ? { ...HEALTHY_STATE }
    : parseHealthState(JSON.parse(raw));
}

function syntheticAvailabilityDiff(snapshot: Snapshot): SnapshotDiff {
  const synthetic = structuredClone(snapshot);
  const rooms = Object.values(synthetic.allRooms).sort(compareRoomNumbers);
  const unavailable = rooms.find((room) => room.status === UNAVAILABLE_STATUS);

  if (unavailable) {
    unavailable.status = AVAILABLE_STATUS;
    unavailable.availability = "Available now";
  } else {
    const available = rooms.find((room) => room.status === AVAILABLE_STATUS);
    if (!available) {
      throw new Error("No room available for synthetic test");
    }
    available.monthlyPrice += " [TEST]";
  }

  synthetic.availableRoomIds = getAvailableRoomIds(synthetic.allRooms);
  synthetic.availableRoomCount = synthetic.availableRoomIds.length;
  const diff = diffSnapshots(snapshot, synthetic);
  if (!diff.hasChanges) {
    throw new Error("Synthetic test produced no change");
  }
  return diff;
}

function syntheticAyntecDiff(
  snapshot: AyntecSnapshot,
): AyntecSnapshotDiff {
  const synthetic = structuredClone(snapshot);
  const target = Object.values(synthetic.entries).sort((left, right) =>
    left.date.localeCompare(right.date) ||
    left.product.localeCompare(right.product, "en")
  ).at(-1);
  if (!target) {
    throw new Error("No AYN shipment entry available for synthetic test");
  }
  target.details += " [TEST]";
  const diff = diffAyntecSnapshots(snapshot, synthetic);
  if (!diff.hasChanges) {
    throw new Error("Synthetic AYN test produced no change");
  }
  return diff;
}

async function sendText(
  deps: MonitorDependencies,
  text: string,
): Promise<void> {
  await deps.sendMessages(splitTelegramText(text));
}

async function runStatus(
  env: WorkerEnv,
  deps: MonitorDependencies,
): Promise<void> {
  const [snapshot, health, ayntecSnapshot, ayntecHealth] = await Promise.all([
    readSnapshot(env),
    readHealth(env),
    readAyntecSnapshot(env),
    readAyntecHealth(env),
  ]);
  await sendText(
    deps,
    [
      formatStatusMessage(
        snapshot,
        health,
        env.PROPERTY_NAME,
        env.ROOMS_URL,
      ),
      formatAyntecStatusMessage(
        ayntecSnapshot,
        ayntecHealth,
        env.AYN_DASHBOARD_URL,
      ),
    ].join("\n\n━━━━━━━━━━\n\n"),
  );
}

async function runTest(
  env: WorkerEnv,
  deps: MonitorDependencies,
): Promise<void> {
  const snapshot = await readSnapshot(env);
  if (snapshot === null) {
    throw new Error("Persisted snapshot is not available");
  }
  await sendText(
    deps,
    formatSyntheticTestMessage(
      syntheticAvailabilityDiff(snapshot),
      env.PROPERTY_NAME,
      env.ROOMS_URL,
    ),
  );
}

async function runAyntecTest(
  env: WorkerEnv,
  deps: MonitorDependencies,
): Promise<void> {
  const snapshot = await readAyntecSnapshot(env);
  if (snapshot === null) {
    throw new Error("Persisted AYN snapshot is not available");
  }
  await sendText(
    deps,
    formatAyntecSyntheticTestMessage(
      syntheticAyntecDiff(snapshot),
      env.AYN_DASHBOARD_URL,
    ),
  );
}

export type TelegramUpdateHandler = (
  update: unknown,
  env: WorkerEnv,
  deps: MonitorDependencies,
) => Promise<void>;

export const handleTelegramUpdate: TelegramUpdateHandler = async (
  update,
  env,
  deps,
) => {
  const message = parseTelegramMessage(update);
  if (
    message === null ||
    message.chatType !== "private" ||
    message.chatId !== env.TELEGRAM_CHAT_ID
  ) {
    deps.log({ level: "info", event: "telegram_update_ignored" });
    return;
  }

  const command = parseCommand(message.text);
  try {
    if (command === "/status") {
      await runStatus(env, deps);
    } else if (command === "/test") {
      await runTest(env, deps);
    } else if (command === "/test_ayntec") {
      await runAyntecTest(env, deps);
    } else {
      await sendText(
        deps,
        formatCommandGuide(
          env.PROPERTY_NAME,
          env.ROOMS_URL,
          !["/start", "/help"].includes(command),
          env.AYN_DASHBOARD_URL,
        ),
      );
    }
    deps.log({ level: "info", event: "telegram_command_completed", command });
  } catch {
    deps.log({ level: "error", event: "telegram_command_failed", command });
    try {
      await sendText(
        deps,
        formatCommandFailure(
          command,
          command === "/test_ayntec"
            ? "AYN Shipping Dashboard"
            : env.PROPERTY_NAME,
          command === "/test_ayntec"
            ? env.AYN_DASHBOARD_URL
            : env.ROOMS_URL,
        ),
      );
    } catch {
      deps.log({
        level: "error",
        event: "telegram_command_error_reply_failed",
        command,
      });
      throw new Error("Telegram command delivery failed");
    }
  }
};
