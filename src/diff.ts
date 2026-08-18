import {
  TRACKED_FIELDS,
  compareRoomNumbers,
  type ChangedRoom,
  type FieldChange,
  type Room,
  type Snapshot,
  type SnapshotDiff,
} from "./model";

function availableRooms(snapshot: Snapshot): Map<string, Room> {
  return new Map(
    snapshot.availableRoomIds.map((id) => [id, snapshot.allRooms[id]]),
  );
}

export function diffSnapshots(
  previous: Snapshot,
  current: Snapshot,
): SnapshotDiff {
  const before = availableRooms(previous);
  const after = availableRooms(current);

  const added = [...after.entries()]
    .filter(([id]) => !before.has(id))
    .map(([, room]) => room)
    .sort(compareRoomNumbers);

  const removed = [...before.entries()]
    .filter(([id]) => !after.has(id))
    .map(([, room]) => room)
    .sort(compareRoomNumbers);

  const changed: ChangedRoom[] = [];
  for (const [id, afterRoom] of after) {
    const beforeRoom = before.get(id);
    if (!beforeRoom) {
      continue;
    }

    const fields: FieldChange[] = TRACKED_FIELDS.flatMap((field) =>
      beforeRoom[field] === afterRoom[field]
        ? []
        : [{
            field,
            before: beforeRoom[field],
            after: afterRoom[field],
          }],
    );
    if (fields.length > 0) {
      changed.push({ before: beforeRoom, after: afterRoom, fields });
    }
  }
  changed.sort((left, right) =>
    compareRoomNumbers(left.after, right.after),
  );

  const beforeCount = previous.availableRoomCount;
  const afterCount = current.availableRoomCount;
  const hasChanges =
    added.length > 0 ||
    removed.length > 0 ||
    changed.length > 0 ||
    beforeCount !== afterCount;

  return {
    added,
    removed,
    changed,
    beforeCount,
    afterCount,
    hasChanges,
  };
}
