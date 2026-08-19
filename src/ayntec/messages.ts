import type {
  HealthState,
} from "../model";
import type {
  AyntecSnapshot,
  AyntecSnapshotDiff,
  ShipmentEntry,
} from "./model";

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

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return day + "/" + month + "/" + year;
}

function entryHeading(entry: ShipmentEntry): string {
  return displayDate(entry.date) + " · " + entry.product;
}

function latestBatchEntries(snapshot: AyntecSnapshot): ShipmentEntry[] {
  return Object.values(snapshot.entries).filter(
    (entry) => entry.date === snapshot.latestDate,
  );
}

function formatLatestBatch(snapshot: AyntecSnapshot): string[] {
  return [
    "Ultimo batch pubblicato (" + displayDate(snapshot.latestDate) + "):",
    ...latestBatchEntries(snapshot).map(
      (entry) => "• " + entry.product + " — " + entry.details,
    ),
  ];
}

export function formatAyntecInitialMessage(
  snapshot: AyntecSnapshot,
  dashboardUrl: string,
): string {
  return [
    "✅ AYN — Shipping Dashboard monitor attivato",
    "",
    "Ultima data pubblicata: " + displayDate(snapshot.latestDate),
    "Righe monitorate: " + snapshot.entryCount,
    "",
    ...formatLatestBatch(snapshot),
    "",
    "Controllo: ogni ora",
    "🔗 " + dashboardUrl,
  ].join("\n");
}

export function formatAyntecNewBatchMessage(
  snapshot: AyntecSnapshot,
  dashboardUrl: string,
): string {
  return [
    "📦 AYN — nuovo batch pubblicato",
    "",
    ...formatLatestBatch(snapshot),
    "",
    "Righe monitorate: " + snapshot.entryCount,
    "🔗 " + dashboardUrl,
  ].join("\n");
}

export function formatAyntecDiffMessage(
  diff: AyntecSnapshotDiff,
  dashboardUrl: string,
): string {
  const lines = ["📦 AYN — Shipping Dashboard aggiornata", ""];
  for (const entry of diff.added) {
    lines.push("➕ " + entryHeading(entry), "   " + entry.details);
  }
  for (const entry of diff.removed) {
    lines.push("➖ " + entryHeading(entry), "   " + entry.details);
  }
  for (const entry of diff.changed) {
    lines.push("✏️ " + entryHeading(entry.after));
    if (entry.before.product !== entry.after.product) {
      lines.push(
        "   Prodotto: " + entry.before.product + " → " +
          entry.after.product,
      );
    }
    if (entry.before.details !== entry.after.details) {
      lines.push(
        "   Dettagli: " + entry.before.details + " → " +
          entry.after.details,
      );
    }
  }
  lines.push(
    "",
    "Righe monitorate: " + diff.beforeCount + " → " + diff.afterCount,
    "🔗 " + dashboardUrl,
  );
  return lines.join("\n");
}

export function formatAyntecStatusMessage(
  snapshot: AyntecSnapshot | null,
  health: HealthState,
  dashboardUrl: string,
): string {
  const hasFailures = health.consecutiveFailures > 0;
  const lastConfirmedAt = latestValidTimestamp(
    health.lastSuccessAt,
    snapshot?.checkedAt ?? null,
  );
  const sections = [
    hasFailures
      ? "⚠️ AYN Shipping Dashboard — monitor con problemi"
      : snapshot === null
        ? "⏳ AYN Shipping Dashboard — monitor in attesa"
        : "✅ AYN Shipping Dashboard — monitor operativo",
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
      "Ultima data pubblicata: " + displayDate(snapshot.latestDate),
      "Righe monitorate: " + snapshot.entryCount,
      formatLatestBatch(snapshot).join("\n"),
      "Ultimo snapshot salvato: " + displayTimestamp(snapshot.checkedAt),
    );
  }

  sections.push("Controllo: ogni ora");
  sections.push(
    hasFailures
      ? "Monitor schedulato: " + health.consecutiveFailures +
        " errori consecutivi"
      : "Monitor schedulato: nessun errore registrato",
  );
  if (hasFailures && health.lastErrorAt !== null) {
    sections.push(
      "Ultimo errore registrato: " + displayTimestamp(health.lastErrorAt),
    );
  }
  if (hasFailures && health.lastError !== null) {
    sections.push("Dettaglio: " + health.lastError);
  }
  sections.push("🔗 " + dashboardUrl);
  return sections.join("\n\n");
}

export function formatAyntecSyntheticTestMessage(
  snapshot: AyntecSnapshot,
  dashboardUrl: string,
): string {
  return [
    "🧪 TEST AYN — NESSUNA RILEVAZIONE REALE",
    "Questa notifica usa l'ultimo snapshot reale, ma nessuna modifica reale è stata salvata.",
    [
      "📦 Batch simulato (" + displayDate(snapshot.latestDate) + "):",
      ...latestBatchEntries(snapshot).map(
        (entry) => "• " + entry.product + " — " + entry.details,
      ),
      "",
      "🔗 " + dashboardUrl,
    ].join("\n"),
  ].join("\n\n");
}
