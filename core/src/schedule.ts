import { DUE_TOLERANCE_MS, TIMEZONE } from "./constants";

/** Due when never run, or `now - last ≥ interval - 60 s` (absorbs tick jitter). */
export const isDue = (last: Date | null, intervalMs: number, now: Date): boolean =>
  last === null || now.getTime() - last.getTime() >= intervalMs - DUE_TOLERANCE_MS;

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since local midnight in America/New_York (DST-safe). */
export const easternMinutes = (date: Date): number => {
  const parts = partsFormatter.formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return h * 60 + m;
};

/** Half-open [start, end) in Eastern time, wrapping midnight; start = end means none. */
export const inQuietHours = (date: Date, quiet: { start: string; end: string }): boolean => {
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  const now = easternMinutes(date);
  return start < end ? now >= start && now < end : now >= start || now < end;
};

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The instant of 00:00 America/New_York on the Eastern calendar day containing `date`. */
export const startOfEasternDay = (date: Date): Date => {
  const get = (parts: Intl.DateTimeFormatPart[], type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const p = dateFormatter.formatToParts(date);
  const y = get(p, "year");
  const mo = get(p, "month");
  const d = get(p, "day");
  // Guess midnight as UTC, then correct by the zone offset at that guess (twice for DST edges)
  let guess = Date.UTC(y, mo - 1, d);
  for (let i = 0; i < 2; i++) {
    const q = dateFormatter.formatToParts(new Date(guess));
    const asUtc = Date.UTC(
      get(q, "year"),
      get(q, "month") - 1,
      get(q, "day"),
      get(q, "hour"),
      get(q, "minute"),
      get(q, "second"),
    );
    guess += Date.UTC(y, mo - 1, d) - asUtc;
  }
  return new Date(guess);
};
