export const FX_SCHEMA_VERSION = 1 as const;
export const FX_SNAPSHOT_KEY = "fx:eurjpy:snapshot:v1";
export const FX_HEALTH_KEY = "fx:eurjpy:health:v1";

export interface FxDailyPoint {
  date: string;
  close: number;
  high: number;
  low: number;
}

export interface FxSnapshot {
  schemaVersion: typeof FX_SCHEMA_VERSION;
  sourceUrl: string;
  checkedAt: string;
  symbol: "EUR/JPY";
  marketDate: string;
  rate: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  history: FxDailyPoint[];
}

export interface FxMetrics {
  dayChange: number;
  dayChangePercent: number;
  yearLow: number;
  yearHigh: number;
  yearChange: number;
  yearChangePercent: number;
}

export function getFxMetrics(snapshot: FxSnapshot): FxMetrics {
  const firstRate = snapshot.history[0].close;
  const dayChange = snapshot.rate - snapshot.previousClose;
  const yearChange = snapshot.rate - firstRate;

  return {
    dayChange,
    dayChangePercent: (dayChange / snapshot.previousClose) * 100,
    yearLow: Math.min(...snapshot.history.map((point) => point.low)),
    yearHigh: Math.max(...snapshot.history.map((point) => point.high)),
    yearChange,
    yearChangePercent: (yearChange / firstRate) * 100,
  };
}
