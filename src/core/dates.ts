/**
 * Calendar helpers shared by the app, the MCP server and the reminder cron.
 *
 * Dates are plain "YYYY-MM-DD" strings in the user's own calendar. Arithmetic runs on UTC
 * Date objects, so results never depend on the time zone of the machine doing the math
 * (a phone in Chicago, a Worker in Frankfurt and CI in UTC all agree).
 */
export { REPEATS, type Repeat } from "./types";

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isValidYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && formatYmd(parseYmd(s)) === s;
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatYmd(d);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY_MS);
}

/** Today's date in an IANA time zone, or in the runtime's local zone when tz is omitted. */
export function localYmd(now: number = Date.now(), tz?: string): string {
  if (!tz) {
    const d = new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/**
 * The next occurrence after `s` for a repeat rule. Monthly repeats clamp to the end of
 * shorter months (Jan 31 → Feb 28) instead of spilling into the next month.
 * An unknown rule advances one day, so loops that call this always terminate.
 */
export function advance(s: string, repeat: string): string {
  const d = parseYmd(s);
  switch (repeat) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly": {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      d.setUTCFullYear(y, m, Math.min(d.getUTCDate(), daysInMonth(y, m)));
      break;
    }
    case "weekdays":
      do d.setUTCDate(d.getUTCDate() + 1);
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      break;
    default: // "daily", and a safe fallback
      d.setUTCDate(d.getUTCDate() + 1);
  }
  return formatYmd(d);
}

/** First occurrence on or after `today`. */
export function rollForward(due: string, repeat: string, today: string): string {
  let d = due;
  while (d < today) d = advance(d, repeat);
  return d;
}

/** First occurrence strictly after `today` (used after completing a repeating quest). */
export function nextOccurrence(due: string, repeat: string, today: string): string {
  let d = advance(due, repeat);
  while (d <= today) d = advance(d, repeat);
  return d;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(ts: number, tz: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  );
}

/** Offset of `tz` from UTC at instant `ts`, in ms. */
function tzOffset(ts: number, tz: string): number {
  const p = parts(ts, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Converts a wall-clock time ("YYYY-MM-DD", "HH:MM") in an IANA zone to a UTC timestamp, handling DST. */
export function zonedTimeToUtc(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffset(guess, tz);
  let t = guess - off1;
  const off2 = tzOffset(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}
