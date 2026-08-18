export const SCHEMA_VERSION = 1 as const;
export const SNAPSHOT_KEY = "house:1142:snapshot:v1";
export const HEALTH_KEY = "house:1142:health:v1";
export const AVAILABLE_STATUS = "vacancy";
export const UNAVAILABLE_STATUS = "novacancy";
export const ROOM_STATUSES = [
  AVAILABLE_STATUS,
  UNAVAILABLE_STATUS,
] as const;

export interface Room {
  id: string;
  number: string;
  status: string;
  availability: string;
  monthlyPrice: string;
  area: string;
  roomType: string;
  floorPlan: string;
}

export interface Snapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  sourceUrl: string;
  checkedAt: string;
  parsedRoomCount: number;
  availableRoomCount: number;
  allRooms: Record<string, Room>;
  availableRoomIds: string[];
}

export interface HealthState {
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  outageDetected: boolean;
  alertSent: boolean;
}

export const HEALTHY_STATE: HealthState = {
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  outageDetected: false,
  alertSent: false,
};

export const TRACKED_FIELDS = [
  "number",
  "availability",
  "monthlyPrice",
  "area",
  "roomType",
  "floorPlan",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

export interface FieldChange {
  field: TrackedField;
  before: string;
  after: string;
}

export interface ChangedRoom {
  before: Room;
  after: Room;
  fields: FieldChange[];
}

export interface SnapshotDiff {
  added: Room[];
  removed: Room[];
  changed: ChangedRoom[];
  beforeCount: number;
  afterCount: number;
  hasChanges: boolean;
}

export interface MonitorEnv {
  STATE: KVNamespace;
  TARGET_URL: string;
  ROOMS_URL: string;
  PROPERTY_NAME: string;
  FAILURE_THRESHOLD: string;
  FETCH_TIMEOUT_MS: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

export interface WorkerEnv extends MonitorEnv {
  AYN_TARGET_URL: string;
  AYN_DASHBOARD_URL: string;
}

export function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function compareRoomNumbers(left: Room, right: Room): number {
  return left.number.localeCompare(right.number, "en", { numeric: true });
}

export function getAvailableRoomIds(
  rooms: Record<string, Room>,
): string[] {
  return Object.values(rooms)
    .filter((room) => room.status === AVAILABLE_STATUS)
    .sort(compareRoomNumbers)
    .map((room) => room.id);
}
