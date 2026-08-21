import type { HealthState } from "../model";
import { getFxMetrics, type FxSnapshot } from "./model";
import type { FxTarget } from "./target";

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
  target: FxTarget | null = null,
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
  if (target === null) {
    lines.push("Target attivo: nessuno");
  } else {
    lines.push(
      "Target attivo: " + RATE_FORMATTER.format(target.threshold) + " JPY",
      "Impostato il: " + displayTimestamp(target.setAt),
    );
  }
  lines.push(
    "Controllo target: ogni 3 minuti (lun–ven)",
    "Riepiloghi: circa 10:00 e 17:00 (ora italiana, lun–ven)",
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

export function formatFxTargetSetMessage(
  target: FxTarget,
  snapshot: FxSnapshot,
  pageUrl: string,
): string {
  return [
    "🎯 Target EUR/JPY attivato: " +
      RATE_FORMATTER.format(target.threshold) + " JPY",
    "Cambio attuale: " + RATE_FORMATTER.format(snapshot.rate) + " JPY",
    "Riceverai un solo avviso quando il cambio raggiungerà o supererà il target.",
    "📈 " + pageUrl,
  ].join("\n");
}

export function formatFxTargetSetPendingMessage(
  target: FxTarget,
  pageUrl: string,
): string {
  return [
    "🎯 Target EUR/JPY attivato: " +
      RATE_FORMATTER.format(target.threshold) + " JPY",
    "Verifica immediata non disponibile.",
    "Il controllo automatico riproverà entro 3 minuti.",
    "📈 " + pageUrl,
  ].join("\n");
}

export function formatFxTargetReachedMessage(
  target: FxTarget,
  snapshot: FxSnapshot,
  pageUrl: string,
): string {
  return [
    "🚨 TARGET EUR/JPY RAGGIUNTO",
    "Target: " + RATE_FORMATTER.format(target.threshold) + " JPY",
    "Cambio rilevato: " + RATE_FORMATTER.format(snapshot.rate) + " JPY",
    "Target disattivato automaticamente dopo questo avviso.",
    "📈 Grafico Il Sole 24 Ore: " + pageUrl,
  ].join("\n");
}

export function formatFxTargetUsageMessage(pageUrl: string): string {
  return [
    "⚠️ Target EUR/JPY non valido",
    "Uso: /set_yen 185,3",
    "Sono accettati sia la virgola sia il punto decimale.",
    "📈 " + pageUrl,
  ].join("\n");
}

export function formatFxTargetClearedMessage(pageUrl: string): string {
  return [
    "✅ Target EUR/JPY disattivato",
    "Non riceverai avvisi di soglia finché non userai di nuovo /set_yen.",
    "📈 " + pageUrl,
  ].join("\n");
}
