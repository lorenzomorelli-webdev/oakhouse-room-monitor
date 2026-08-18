import { describe, expect, it } from "vitest";
import { diffAyntecSnapshots } from "../src/ayntec/diff";
import {
  formatAyntecDiffMessage,
  formatAyntecInitialMessage,
  formatAyntecStatusMessage,
  formatAyntecSyntheticTestMessage,
} from "../src/ayntec/messages";
import type { ShipmentEntry } from "../src/ayntec/model";
import { parseAyntecHtml } from "../src/ayntec/parser";
import { HEALTHY_STATE } from "../src/model";
import { AYNTEC_DASHBOARD_HTML } from "./fixtures/ayntec";

const SOURCE_URL =
  "https://www.ayntec.com/pages/shipment-dashboard?section_id=main-page";
const DASHBOARD_URL = "https://www.ayntec.com/pages/shipment-dashboard";

describe("AYN Telegram messages", () => {
  it("renders a concise initial dashboard baseline", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );

    const text = formatAyntecInitialMessage(snapshot, DASHBOARD_URL);

    expect(text).toContain("✅ AYN — Shipping Dashboard monitor attivato");
    expect(text).toContain("Ultima data pubblicata: 17/08/2026");
    expect(text).toContain("Righe monitorate: 5");
    expect(text).toContain(DASHBOARD_URL);
  });

  it("summarizes added, removed, and changed shipment rows with a link", async () => {
    const previous = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const current = structuredClone(previous);
    delete current.entries["2026-08-15|ayn thor black pro"];
    current.entries["2026-08-17|ayn thor rainbow pro"].details =
      "2502xx--2540xx";
    const added: ShipmentEntry = {
      id: "2026-08-18|ayn thor white max",
      date: "2026-08-18",
      product: "AYN Thor White Max",
      details: "2381xx--2400xx",
    };
    current.entries[added.id] = added;
    current.latestDate = "2026-08-18";

    const text = formatAyntecDiffMessage(
      diffAyntecSnapshots(previous, current),
      DASHBOARD_URL,
    );

    expect(text).toContain("📦 AYN — Shipping Dashboard aggiornata");
    expect(text).toContain("➕ 18/08/2026 · AYN Thor White Max");
    expect(text).toContain("2381xx--2400xx");
    expect(text).toContain("➖ 15/08/2026 · AYN Thor Black Pro");
    expect(text).toContain("2502xx--2529xx → 2502xx--2540xx");
    expect(text).toContain("Righe monitorate: 5 → 5");
    expect(text).toContain(DASHBOARD_URL);
  });

  it("renders persisted dashboard status without fetching the page", async () => {
    const snapshot = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );

    const text = formatAyntecStatusMessage(
      snapshot,
      {
        ...HEALTHY_STATE,
        lastSuccessAt: "2026-08-18T16:30:00.000Z",
      },
      DASHBOARD_URL,
    );

    expect(text).toContain("✅ AYN Shipping Dashboard — monitor operativo");
    expect(text).toContain("Ultimo controllo confermato: 18/08/26, 18:30:00");
    expect(text).toContain("Ultima data pubblicata: 17/08/2026");
    expect(text).toContain("Righe monitorate: 5");
    expect(text).toContain("Controllo: ogni 30 minuti");
    expect(text).toContain(DASHBOARD_URL);
  });

  it("labels the synthetic AYN diff and explains that state is unchanged", async () => {
    const previous = await parseAyntecHtml(
      AYNTEC_DASHBOARD_HTML,
      SOURCE_URL,
      "2026-08-18T16:00:00.000Z",
    );
    const current = structuredClone(previous);
    current.entries["2026-08-17|ayn thor rainbow max(512)"].details +=
      " [TEST]";

    const text = formatAyntecSyntheticTestMessage(
      diffAyntecSnapshots(previous, current),
      DASHBOARD_URL,
    );

    expect(text).toContain("🧪 TEST AYN — simulazione controllata");
    expect(text).toContain("nessuna modifica reale è stata salvata");
    expect(text).toContain("✏️ 17/08/2026 · AYN Thor Rainbow Max(512)");
    expect(text).toContain(DASHBOARD_URL);
  });
});
