export const FX_DIGEST_HOURS = [9, 13, 17, 21] as const;

const ITALIAN_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

export function isFxDigestDue(date: Date): boolean {
  if (!Number.isFinite(date.getTime())) {
    return false;
  }
  const parts = Object.fromEntries(
    ITALIAN_CLOCK.formatToParts(date).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  const hour = Number(parts.hour);
  return FX_DIGEST_HOURS.some((scheduledHour) => scheduledHour === hour);
}
