export const FX_TARGET_SCHEMA_VERSION = 1 as const;
export const FX_TARGET_KEY = "fx:eurjpy:target:v1";

export interface FxTarget {
  schemaVersion: typeof FX_TARGET_SCHEMA_VERSION;
  threshold: number;
  setAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFxTargetState(value: unknown): FxTarget {
  if (
    !isRecord(value) ||
    value.schemaVersion !== FX_TARGET_SCHEMA_VERSION ||
    typeof value.threshold !== "number" ||
    !Number.isFinite(value.threshold) ||
    value.threshold <= 0 ||
    value.threshold > 1_000 ||
    typeof value.setAt !== "string" ||
    !Number.isFinite(Date.parse(value.setAt))
  ) {
    throw new Error("Invalid persisted EUR/JPY target");
  }
  return {
    schemaVersion: FX_TARGET_SCHEMA_VERSION,
    threshold: value.threshold,
    setAt: value.setAt,
  };
}

export function parseFxTargetInput(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("Invalid EUR/JPY target");
  }
  const threshold = Number(normalized);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1_000) {
    throw new Error("Invalid EUR/JPY target");
  }
  return threshold;
}

export function createFxTarget(value: string, setAt: string): FxTarget {
  return {
    schemaVersion: FX_TARGET_SCHEMA_VERSION,
    threshold: parseFxTargetInput(value),
    setAt,
  };
}
