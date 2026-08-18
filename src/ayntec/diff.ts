import type {
  AyntecSnapshot,
  AyntecSnapshotDiff,
  ShipmentEntry,
} from "./model";

function compareEntries(left: ShipmentEntry, right: ShipmentEntry): number {
  return left.date.localeCompare(right.date) ||
    left.product.localeCompare(right.product, "en", { numeric: true });
}

export function diffAyntecSnapshots(
  previous: AyntecSnapshot,
  current: AyntecSnapshot,
): AyntecSnapshotDiff {
  const previousIds = new Set(Object.keys(previous.entries));
  const currentIds = new Set(Object.keys(current.entries));
  const added = Object.values(current.entries)
    .filter((entry) => !previousIds.has(entry.id))
    .sort(compareEntries);
  const removed = Object.values(previous.entries)
    .filter((entry) => !currentIds.has(entry.id))
    .sort(compareEntries);
  const changed = Object.values(current.entries)
    .filter((entry) => previousIds.has(entry.id))
    .filter((entry) => {
      const before = previous.entries[entry.id];
      return before.date !== entry.date ||
        before.product !== entry.product ||
        before.details !== entry.details;
    })
    .sort(compareEntries)
    .map((after) => ({ before: previous.entries[after.id], after }));

  return {
    added,
    removed,
    changed,
    beforeCount: previousIds.size,
    afterCount: currentIds.size,
    hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}
