import {
  ROOM_STATUSES,
  SCHEMA_VERSION,
  getAvailableRoomIds,
  type HealthState,
  type Room,
  type Snapshot,
} from "./model";

const ROOM_FIELDS = [
  "id",
  "number",
  "status",
  "availability",
  "monthlyPrice",
  "area",
  "roomType",
  "floorPlan",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function invalidSnapshot(): never {
  throw new Error("Invalid persisted snapshot");
}

function invalidHealth(): never {
  throw new Error("Invalid persisted health state");
}

function parseRoom(key: string, value: unknown): Room {
  if (!isRecord(value)) {
    return invalidSnapshot();
  }
  for (const field of ROOM_FIELDS) {
    if (!isNonEmptyString(value[field])) {
      return invalidSnapshot();
    }
  }
  if (value.id !== key) {
    return invalidSnapshot();
  }
  if (!ROOM_STATUSES.includes(
    value.status as (typeof ROOM_STATUSES)[number],
  )) {
    return invalidSnapshot();
  }
  return value as unknown as Room;
}

export function parseSnapshotState(value: unknown): Snapshot {
  if (!isRecord(value)) {
    return invalidSnapshot();
  }
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    !isNonEmptyString(value.sourceUrl) ||
    !isNonEmptyString(value.checkedAt) ||
    !isNonNegativeInteger(value.parsedRoomCount) ||
    value.parsedRoomCount === 0 ||
    !isNonNegativeInteger(value.availableRoomCount) ||
    !isRecord(value.allRooms) ||
    !Array.isArray(value.availableRoomIds) ||
    !value.availableRoomIds.every(isNonEmptyString)
  ) {
    return invalidSnapshot();
  }

  const rooms = Object.fromEntries(
    Object.entries(value.allRooms).map(([key, room]) => [
      key,
      parseRoom(key, room),
    ]),
  );
  const roomKeys = Object.keys(rooms);
  const availableRoomIds = value.availableRoomIds as string[];
  const expectedAvailableIds = getAvailableRoomIds(rooms);

  if (
    roomKeys.length !== value.parsedRoomCount ||
    new Set(availableRoomIds).size !== availableRoomIds.length ||
    availableRoomIds.length !== value.availableRoomCount ||
    expectedAvailableIds.length !== availableRoomIds.length ||
    expectedAvailableIds.some((id, index) => id !== availableRoomIds[index])
  ) {
    return invalidSnapshot();
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceUrl: value.sourceUrl,
    checkedAt: value.checkedAt,
    parsedRoomCount: value.parsedRoomCount,
    availableRoomCount: value.availableRoomCount,
    allRooms: rooms,
    availableRoomIds,
  };
}

export function parseHealthState(value: unknown): HealthState {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.consecutiveFailures) ||
    !isNullableString(value.lastSuccessAt) ||
    !isNullableString(value.lastErrorAt) ||
    !isNullableString(value.lastError) ||
    typeof value.outageDetected !== "boolean" ||
    typeof value.alertSent !== "boolean" ||
    (value.alertSent && !value.outageDetected) ||
    (value.consecutiveFailures === 0 &&
      (value.outageDetected || value.alertSent))
  ) {
    return invalidHealth();
  }

  return {
    consecutiveFailures: value.consecutiveFailures,
    lastSuccessAt: value.lastSuccessAt,
    lastErrorAt: value.lastErrorAt,
    lastError: value.lastError,
    outageDetected: value.outageDetected,
    alertSent: value.alertSent,
  };
}
