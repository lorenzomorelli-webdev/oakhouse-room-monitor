export const FX_DIGEST_HOURS = [10, 17] as const;

const ITALIAN_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface FxScheduleDecision {
  shouldPoll: boolean;
  sendDigest: boolean;
}

export function getFxSchedule(date: Date): FxScheduleDecision {
  if (!Number.isFinite(date.getTime())) {
    return { shouldPoll: false, sendDigest: false };
  }
  const parts = Object.fromEntries(
    ITALIAN_CLOCK.formatToParts(date).map((part) => [part.type, part.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return { shouldPoll: false, sendDigest: false };
  }
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    shouldPoll: true,
    sendDigest: minute === 0 &&
      FX_DIGEST_HOURS.some((scheduledHour) => scheduledHour === hour),
  };
}

export function isFxDigestDue(date: Date): boolean {
  return getFxSchedule(date).sendDigest;
}
