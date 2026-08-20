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
  schemaVersion: 1,
  sourceUrl: "https://api.twelvedata.com/time_series",
  checkedAt: "2026-08-20T14:00:00.000Z",
  symbol: "EUR/JPY",
  marketDate: "2026-08-20",
  rate: 185.4255,
  dayOpen: 184.6385,
  dayHigh: 185.78,
  dayLow: 184.502,
  previousClose: 184.6385,
  history: [
    { date: "2025-08-21", close: 172.11, high: 172.44, low: 170.918 },
    { date: "2025-11-20", close: 178.86, high: 179.12, low: 177.95 },
    { date: "2026-05-20", close: 186.81, high: 187.568, low: 185.44 },
    { date: "2026-08-20", close: 185.4255, high: 185.78, low: 184.502 },
  ],
};

describe("FX messages", () => {
  it("formats the scheduled digest without a target or trading advice", () => {
    const text = formatFxDigestMessage(snapshot, PAGE_URL);

    expect(text).toContain("EUR/JPY");
    expect(text).toContain("1 EUR = 185,4255 JPY");
    expect(text).toContain("+0,43%");
    expect(text).toContain("Chiusura precedente: 184,6385");
    expect(text).toContain("Intervallo oggi: 184,5020 – 185,7800");
    expect(text).toContain("Intervallo 1 anno: 170,9180 – 187,5680");
    expect(text).toContain("Andamento 1 anno: +7,74%");
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
    expect(text).toContain("Riepiloghi: 09:00, 13:00, 17:00 e 21:00");
  });

  it("marks a manual test clearly without changing or inventing rates", () => {
    const text = formatFxSyntheticTestMessage(snapshot, PAGE_URL);

    expect(text).toContain("🧪 TEST EUR/JPY");
    expect(text).toContain("nessuna rilevazione reale");
    expect(text).toContain("1 EUR = 185,4255 JPY");
    expect(text).toContain(PAGE_URL);
    expect(text).not.toContain("obiettivo");
  });
});
