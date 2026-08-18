export const AYNTEC_SCHEMA_VERSION = 1 as const;

export interface ShipmentEntry {
  id: string;
  date: string;
  product: string;
  details: string;
}

export interface AyntecSnapshot {
  schemaVersion: typeof AYNTEC_SCHEMA_VERSION;
  sourceUrl: string;
  checkedAt: string;
  entryCount: number;
  latestDate: string;
  entries: Record<string, ShipmentEntry>;
}

export interface ChangedShipmentEntry {
  before: ShipmentEntry;
  after: ShipmentEntry;
}

export interface AyntecSnapshotDiff {
  added: ShipmentEntry[];
  removed: ShipmentEntry[];
  changed: ChangedShipmentEntry[];
  beforeCount: number;
  afterCount: number;
  hasChanges: boolean;
}
