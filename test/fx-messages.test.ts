import { describe, expect, it } from "vitest";
import {
  formatFxDigestMessage,
  formatFxStatusMessage,
  formatFxSyntheticTestMessage,
} from "../src/fx/messages";
import type { FxSnapshot } from "../src/fx/model";
import { HEALTHY_STATE } from "../src/model";

const PAGE_URL =
  "https://mercati.ilsole24ore.com/tassi-e-valute/valute/contro-euro/cambio/JPYVS.FX";
const snapshot: FxSnapshot = {
  schemaVersion: 2,
  sourceUrl: "https://api.twelvedata.com/quote",
  checkedAt: "2026-08-20T14:00:00.000Z",
  symbol: "EUR/JPY",
  marketDate: "2026-08-20",
  rate: 185.4255,
  dayOpen: 184.6385,
  dayHigh: 185.78,
  dayLow: 184.502,
  previousClose: 184.6385,
  yearLow: 170.918,
  yearHigh: 187.568,
};

describe("FX messages", () => {
  it("formats the scheduled digest without a target or trading advice", () => {
    const text = formatFxDigestMessage(snapshot, PAGE_URL);

    expect(text).toContain("EUR/JPY");
    expect(text).toContain("1 EUR = 185,4255 JPY");
    expect(text).toContain("+0,43%");
    expect(text).toContain("Chiusura precedente: 184,6385");
    expect(text).toContain("Intervallo oggi: 184,5020 – 185,7800");
    expect(text).toContain("Intervallo 52 settimane: 170,9180 – 187,5680");
    expect(text).toContain("Distanza dal massimo: -1,14%");
    expect(text).toContain(PAGE_URL);
    expect(text).not.toContain("186,5");
    expect(text).not.toContain("obiettivo");
  });

  it("formats persisted FX status independently from scheduled fetching", () => {
    const text = formatFxStatusMessage(
      snapshot,
      { ...HEALTHY_STATE, lastSuccessAt: snapshot.checkedAt },
      PAGE_URL,
    );

    expect(text).toContain("EUR/JPY — monitor operativo");
    expect(text).toContain("Ultimo cambio: 185,4255 JPY per 1 EUR");
    expect(text).toContain("Target attivo: nessuno");
    expect(text).toContain("Controllo target: ogni 3 minuti (lun–ven)");
    expect(text).toContain("Riepiloghi: circa 10:00 e 17:00 (ora italiana, lun–ven)");
  });

  it("marks a live manual test clearly without saving or inventing rates", () => {
    const text = formatFxSyntheticTestMessage(snapshot, PAGE_URL);

    expect(text).toContain("🧪 TEST EUR/JPY");
    expect(text).toContain("appena letto");
    expect(text).toContain("nessuna rilevazione reale");
    expect(text).toContain("1 EUR = 185,4255 JPY");
    expect(text).toContain(PAGE_URL);
    expect(text).not.toContain("obiettivo");
  });
});
