import type { HealthState } from "../model";
import { getFxMetrics, type FxSnapshot } from "./model";

const RATE_FORMATTER = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

function displayTimestamp(value: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return day + "/" + month + "/" + year;
}

export function formatFxDigestMessage(
  snapshot: FxSnapshot,
  pageUrl: string,
): string {
  const metrics = getFxMetrics(snapshot);
  return [
    "💴 EUR/JPY — aggiornamento cambio",
    "1 EUR = " + RATE_FORMATTER.format(snapshot.rate) + " JPY",
    "Variazione giornaliera: " + PERCENT_FORMATTER.format(metrics.dayChangePercent) + "%",
    "Chiusura precedente: " + RATE_FORMATTER.format(snapshot.previousClose),
    "Intervallo oggi: " + RATE_FORMATTER.format(snapshot.dayLow) + " – " + RATE_FORMATTER.format(snapshot.dayHigh),
    "Intervallo 52 settimane: " + RATE_FORMATTER.format(metrics.yearLow) + " – " + RATE_FORMATTER.format(metrics.yearHigh),
    "Distanza dal massimo: " + PERCENT_FORMATTER.format(metrics.yearHighDistancePercent) + "%",
    "Dato di mercato: " + displayDate(snapshot.marketDate),
    "",
    "Valore indicativo; il cambio applicato può includere spread e commissioni.",
    "📈 Grafico Il Sole 24 Ore: " + pageUrl,
  ].join("\n");
}

export function formatFxStatusMessage(
  snapshot: FxSnapshot | null,
  health: HealthState,
  pageUrl: string,
): string {
  const hasFailures = health.consecutiveFailures > 0;
  const lines = [
    hasFailures
      ? "⚠️ EUR/JPY — monitor con problemi"
      : snapshot === null
        ? "⏳ EUR/JPY — monitor in attesa"
        : "✅ EUR/JPY — monitor operativo",
  ];

  if (snapshot === null) {
    lines.push("Ultimo cambio: non ancora disponibile");
  } else {
    lines.push(
      "Ultimo cambio: " + RATE_FORMATTER.format(snapshot.rate) + " JPY per 1 EUR",
      "Ultimo controllo confermato: " + displayTimestamp(snapshot.checkedAt),
      "Data di mercato: " + displayDate(snapshot.marketDate),
    );
  }
  lines.push(
    "Riepiloghi: circa 09:02, 13:02, 17:02 e 21:02 (ora italiana, lun–ven)",
    hasFailures
      ? "Monitor schedulato: " + health.consecutiveFailures + " errori consecutivi"
      : "Monitor schedulato: nessun errore registrato",
  );
  if (hasFailures && health.lastError !== null) {
    lines.push("Dettaglio: " + health.lastError);
  }
  lines.push("📈 " + pageUrl);
  return lines.join("\n\n");
}

export function formatFxSyntheticTestMessage(
  snapshot: FxSnapshot,
  pageUrl: string,
): string {
  return [
    "🧪 TEST EUR/JPY — simulazione controllata",
    "Questo messaggio usa il cambio reale appena letto; nessuna rilevazione reale è stata salvata.",
    formatFxDigestMessage(snapshot, pageUrl),
  ].join("\n\n");
}
