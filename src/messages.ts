import {
  type ChangedRoom,
  type HealthState,
  type Room,
  type Snapshot,
  type SnapshotDiff,
  type TrackedField,
} from "./model";

const FIELD_LABELS: Record<TrackedField, string> = {
  number: "🔢 Numero camera",
  availability: "📅 Disponibilità",
  monthlyPrice: "💴 Totale mensile",
  area: "📐 Superficie",
  roomType: "🛏 Tipologia",
  floorPlan: "🏠 Pianta",
};

function displayAvailability(value: string): string {
  return value === "Available now" ? "subito" : value;
}

function displayTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Rome",
  }).format(new Date(timestamp));
}

function latestValidTimestamp(
  ...values: Array<string | null>
): string | null {
  let latestValue: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === null) {
      continue;
    }
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && timestamp > latestTime) {
      latestValue = value;
      latestTime = timestamp;
    }
  }
  return latestValue;
}

function roomSummary(prefix: string, room: Room): string {
  return [
    prefix + " Camera " + room.number,
    "📅 Disponibile da: " + displayAvailability(room.availability),
    "💴 Totale mensile: " + room.monthlyPrice,
    "📐 Superficie: " + room.area,
    "🛏 " + room.roomType + (room.floorPlan ? " · " + room.floorPlan : ""),
  ].join("\n");
}

function changedRoomSummary(change: ChangedRoom): string {
  const lines = ["🔄 Camera " + change.after.number];
  for (const field of change.fields) {
    lines.push(
      FIELD_LABELS[field.field] +
        ": " +
        displayAvailability(field.before) +
        " → " +
        displayAvailability(field.after),
    );
  }
  return lines.join("\n");
}

export function formatInitialMessage(
  snapshot: Snapshot,
  propertyName: string,
  roomsUrl: string,
): string {
  const sections = [
    "✅ " + propertyName + " — monitor attivato",
    "Camere disponibili: " + snapshot.availableRoomCount,
  ];
  for (const id of snapshot.availableRoomIds) {
    sections.push(roomSummary("•", snapshot.allRooms[id]));
  }
  sections.push("🔗 " + roomsUrl);
  return sections.join("\n\n");
}

export function formatDiffMessage(
  diff: SnapshotDiff,
  propertyName: string,
  roomsUrl: string,
): string {
  const sections = ["🏠 " + propertyName + " — disponibilità modificata"];
  for (const room of diff.added) {
    sections.push(roomSummary("➕", room));
  }
  for (const room of diff.removed) {
    sections.push("➖ Camera " + room.number + " non è più disponibile");
  }
  for (const change of diff.changed) {
    sections.push(changedRoomSummary(change));
  }
  sections.push(
    "Camere disponibili: " + diff.beforeCount + " → " + diff.afterCount,
  );
  sections.push("🔗 " + roomsUrl);
  return sections.join("\n\n");
}

export function formatFailureMessage(
  propertyName: string,
  failures: number,
  error: string,
  roomsUrl: string,
): string {
  return [
    "⚠️ " + propertyName + " — monitor in errore",
    failures + " controlli consecutivi non riusciti.",
    "Ultimo errore: " + error.slice(0, 160),
    "Lo snapshot valido precedente è stato conservato.",
    "🔗 " + roomsUrl,
  ].join("\n");
}

export function formatRecoveryMessage(
  propertyName: string,
  roomsUrl: string,
): string {
  return [
    "✅ " + propertyName + " — monitor nuovamente operativo",
    "Il controllo della pagina è ripreso correttamente.",
    "🔗 " + roomsUrl,
  ].join("\n");
}

export function formatCommandGuide(
  propertyName: string,
  roomsUrl: string,
  unknownCommand = false,
): string {
  return [
    unknownCommand ? "❓ Comando non riconosciuto" : "🤖 " + propertyName + " — monitor operativo",
    "/status — mostra l'ultimo controllo confermato dal monitor",
    "/test — simula una modifica sull'ultimo snapshot senza salvarla",
    "/help — mostra questa guida",
    "🔗 " + roomsUrl,
  ].join("\n");
}

export function formatStatusMessage(
  snapshot: Snapshot | null,
  health: HealthState,
  propertyName: string,
  roomsUrl: string,
): string {
  const lastConfirmedAt = latestValidTimestamp(
    health.lastSuccessAt,
    snapshot?.checkedAt ?? null,
  );
  const hasFailures = health.consecutiveFailures > 0;
  const sections = [
    hasFailures
      ? "⚠️ " + propertyName + " — monitor con problemi"
      : snapshot === null
        ? "⏳ " + propertyName + " — monitor in attesa"
        : "✅ " + propertyName + " — monitor operativo",
    "Ultimo controllo confermato: " + (
      lastConfirmedAt === null
        ? "non ancora disponibile"
        : displayTimestamp(lastConfirmedAt)
    ),
  ];

  if (snapshot === null) {
    sections.push("Snapshot: non ancora disponibile");
  } else {
    sections.push(
      "Stanze analizzate: " + snapshot.parsedRoomCount,
      "Camere disponibili: " + snapshot.availableRoomCount,
    );

    if (snapshot.availableRoomIds.length > 0) {
      sections.push(
        snapshot.availableRoomIds
          .map((id) => {
            const room = snapshot.allRooms[id];
            return "• Camera " + room.number + " — " + displayAvailability(room.availability);
          })
          .join("\n"),
      );
    }

    sections.push(
      "Ultimo snapshot notificato: " + displayTimestamp(snapshot.checkedAt),
    );
  }

  sections.push(
    !hasFailures
      ? "Monitor schedulato: nessun errore registrato"
      : "Monitor schedulato: " + health.consecutiveFailures + " errori consecutivi",
  );
  if (hasFailures && health.lastErrorAt !== null) {
    sections.push(
      "Ultimo errore registrato: " + displayTimestamp(health.lastErrorAt),
    );
  }
  if (hasFailures && health.lastError !== null) {
    sections.push("Dettaglio: " + health.lastError);
  }
  sections.push("🔗 " + roomsUrl);
  return sections.join("\n\n");
}

export function formatSyntheticTestMessage(
  diff: SnapshotDiff,
  propertyName: string,
  roomsUrl: string,
): string {
  return [
    "🧪 TEST — simulazione controllata",
    "Questa notifica usa l'ultimo snapshot reale, ma nessuna modifica reale è stata salvata.",
    formatDiffMessage(diff, propertyName, roomsUrl),
  ].join("\n\n");
}

export function formatCommandFailure(
  command: string,
  propertyName: string,
  roomsUrl: string,
): string {
  return [
    "⚠️ " + propertyName + " — comando " + command + " non riuscito",
    "Il monitor schedulato continua a funzionare. Riprova tra poco.",
    "🔗 " + roomsUrl,
  ].join("\n");
}

export function splitTelegramText(
  text: string,
  limit = 4000,
): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let current = "";
  for (const originalLine of text.split("\n")) {
    let line = originalLine;
    const candidate = current ? current + "\n" + line : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    while (line.length > limit) {
      chunks.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    current = line;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}
