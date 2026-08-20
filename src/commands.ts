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
} from "./ayntec/model";
import { parseAyntecSnapshotState } from "./ayntec/state";
import { diffSnapshots } from "./diff";
import {
  formatFxDigestMessage,
  formatFxStatusMessage,
  formatFxSyntheticTestMessage,
} from "./fx/messages";
import {
  FX_HEALTH_KEY,
  FX_SNAPSHOT_KEY,
  type FxSnapshot,
} from "./fx/model";
import { parseFxSnapshotState } from "./fx/state";
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
  formatStatusUnavailable,
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
  | "/yen"
  | "/test_yen"
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
    "/yen",
    "/test_yen",
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

async function readFxSnapshot(env: WorkerEnv): Promise<FxSnapshot | null> {
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

async function readFxHealth(env: WorkerEnv): Promise<HealthState> {
  const raw = await env.STATE.get(FX_HEALTH_KEY, {
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

function nextCalendarDate(value: string): string {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function syntheticAyntecNewBatch(
  snapshot: AyntecSnapshot,
): AyntecSnapshot {
  const synthetic = structuredClone(snapshot);
  const nextDate = nextCalendarDate(snapshot.latestDate);
  const latestBatch = Object.values(snapshot.entries).filter(
    (entry) => entry.date === snapshot.latestDate,
  );
  if (latestBatch.length === 0) {
    throw new Error("No AYN shipment batch available for synthetic test");
  }
  for (const entry of latestBatch) {
    const id = nextDate + "|" +
      entry.product.normalize("NFKC").toLocaleLowerCase("en-US");
    synthetic.entries[id] = {
      ...entry,
      id,
      date: nextDate,
    };
  }
  synthetic.latestDate = nextDate;
  synthetic.entryCount = Object.keys(synthetic.entries).length;
  return synthetic;
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
  const [oakhouse, ayntec, fx] = await Promise.allSettled([
    Promise.all([readSnapshot(env), readHealth(env)]).then(
      ([snapshot, health]) => formatStatusMessage(
        snapshot,
        health,
        env.PROPERTY_NAME,
        env.ROOMS_URL,
      ),
    ),
    Promise.all([readAyntecSnapshot(env), readAyntecHealth(env)]).then(
      ([snapshot, health]) => formatAyntecStatusMessage(
        snapshot,
        health,
        env.AYN_DASHBOARD_URL,
      ),
    ),
    Promise.all([readFxSnapshot(env), readFxHealth(env)]).then(
      ([snapshot, health]) => formatFxStatusMessage(
        snapshot,
        health,
        env.FX_PAGE_URL,
      ),
    ),
  ]);
  if (oakhouse.status === "rejected") {
    deps.log({
      level: "error",
      event: "telegram_status_section_failed",
      monitor: "oakhouse",
    });
  }
  if (ayntec.status === "rejected") {
    deps.log({
      level: "error",
      event: "telegram_status_section_failed",
      monitor: "ayntec",
    });
  }
  if (fx.status === "rejected") {
    deps.log({
      level: "error",
      event: "telegram_status_section_failed",
      monitor: "fx",
    });
  }
  await sendText(
    deps,
    [
      oakhouse.status === "fulfilled"
        ? oakhouse.value
        : formatStatusUnavailable(env.PROPERTY_NAME, env.ROOMS_URL),
      ayntec.status === "fulfilled"
        ? ayntec.value
        : formatStatusUnavailable(
          "AYN Shipping Dashboard",
          env.AYN_DASHBOARD_URL,
        ),
      fx.status === "fulfilled"
        ? fx.value
        : formatStatusUnavailable("EUR/JPY", env.FX_PAGE_URL),
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
      syntheticAyntecNewBatch(snapshot),
      env.AYN_DASHBOARD_URL,
    ),
  );
}

async function runFxDigest(
  env: WorkerEnv,
  deps: MonitorDependencies,
): Promise<void> {
  const snapshot = await readFxSnapshot(env);
  if (snapshot === null) {
    throw new Error("Persisted FX snapshot is not available");
  }
  await sendText(deps, formatFxDigestMessage(snapshot, env.FX_PAGE_URL));
}

async function runFxTest(
  env: WorkerEnv,
  deps: MonitorDependencies,
): Promise<void> {
  const snapshot = await readFxSnapshot(env);
  if (snapshot === null) {
    throw new Error("Persisted FX snapshot is not available");
  }
  await sendText(
    deps,
    formatFxSyntheticTestMessage(snapshot, env.FX_PAGE_URL),
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
    } else if (command === "/yen") {
      await runFxDigest(env, deps);
    } else if (command === "/test_yen") {
      await runFxTest(env, deps);
    } else {
      if (["/start", "/help"].includes(command) && deps.syncCommandMenu) {
        try {
          await deps.syncCommandMenu();
          deps.log({
            level: "info",
            event: "telegram_command_menu_synced",
          });
        } catch {
          deps.log({
            level: "error",
            event: "telegram_command_menu_sync_failed",
          });
        }
      }
      await sendText(
        deps,
        formatCommandGuide(
          env.PROPERTY_NAME,
          env.ROOMS_URL,
          !["/start", "/help"].includes(command),
          env.AYN_DASHBOARD_URL,
          env.FX_PAGE_URL,
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
            : ["/yen", "/test_yen"].includes(command)
              ? "EUR/JPY"
              : env.PROPERTY_NAME,
          command === "/test_ayntec"
            ? env.AYN_DASHBOARD_URL
            : ["/yen", "/test_yen"].includes(command)
              ? env.FX_PAGE_URL
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
