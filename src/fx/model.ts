export const FX_SCHEMA_VERSION = 2 as const;
export const FX_SNAPSHOT_KEY = "fx:eurjpy:snapshot:v2";
export const FX_HEALTH_KEY = "fx:eurjpy:health:v1";

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
  yearLow: number;
  yearHigh: number;
}

export interface FxMetrics {
  dayChange: number;
  dayChangePercent: number;
  yearLow: number;
  yearHigh: number;
  yearHighDistancePercent: number;
}

export function getFxMetrics(snapshot: FxSnapshot): FxMetrics {
  const dayChange = snapshot.rate - snapshot.previousClose;

  return {
    dayChange,
    dayChangePercent: (dayChange / snapshot.previousClose) * 100,
    yearLow: snapshot.yearLow,
    yearHigh: snapshot.yearHigh,
    yearHighDistancePercent:
      ((snapshot.rate - snapshot.yearHigh) / snapshot.yearHigh) * 100,
  };
}
