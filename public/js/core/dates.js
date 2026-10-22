// @ts-check
/**
 * Calendar helpers shared by the app, the MCP server and the reminder cron.
 *
 * Dates are plain "YYYY-MM-DD" strings in the user's own calendar. Arithmetic runs on UTC
 * Date objects, so results never depend on the time zone of the machine doing the math
 * (a phone in Chicago, a Worker in Frankfurt and CI in UTC all agree).
 */

/** @typedef {"none" | "daily" | "weekdays" | "weekly" | "monthly"} Repeat */

export const REPEATS = /** @type {const} */ (["none", "daily", "weekdays", "weekly", "monthly"]);

const DAY_MS = 86_400_000;
const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");

/** @param {string} s "YYYY-MM-DD" */
export function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** @param {Date} d a UTC date */
export function formatYmd(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** @param {string} s */
export function isValidYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && formatYmd(parseYmd(s)) === s;
}

/** @param {string} s @param {number} n */
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatYmd(d);
}

/** Whole days from a to b (positive when b is later). @param {string} a @param {string} b */
export function daysBetween(a, b) {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY_MS);
}

/**
 * Today's date in an IANA time zone, or in the runtime's local zone when tz is omitted.
 * @param {number} [now] ms since epoch
 * @param {string} [tz]
 */
export function localYmd(now = Date.now(), tz) {
  if (!tz) {
    const d = new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

const daysInMonth = (/** @type {number} */ y, /** @type {number} */ m0) =>
  new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/**
 * The next occurrence after `s` for a repeat rule. Monthly repeats clamp to the end of
 * shorter months (Jan 31 → Feb 28) instead of spilling into the next month.
 * An unknown rule advances one day, so loops that call this always terminate.
 * @param {string} s @param {string} repeat
 */
export function advance(s, repeat) {
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

/** First occurrence on or after `today`. @param {string} due @param {string} repeat @param {string} today */
export function rollForward(due, repeat, today) {
  let d = due;
  while (d < today) d = advance(d, repeat);
  return d;
}

/** First occurrence strictly after `today` (used after completing a repeating quest). @param {string} due @param {string} repeat @param {string} today */
export function nextOccurrence(due, repeat, today) {
  let d = advance(due, repeat);
  while (d <= today) d = advance(d, repeat);
  return d;
}

/** @param {string} tz */
export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** @param {number} ts @param {string} tz */
function parts(ts, tz) {
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

/** Offset of `tz` from UTC at instant `ts`, in ms. @param {number} ts @param {string} tz */
function tzOffset(ts, tz) {
  const p = parts(ts, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * Converts a wall-clock time in an IANA zone to a UTC timestamp, handling DST.
 * @param {string} date "YYYY-MM-DD" @param {string} time "HH:MM" @param {string} tz
 */
export function zonedTimeToUtc(date, time, tz) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffset(guess, tz);
  let t = guess - off1;
  const off2 = tzOffset(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}
