// @ts-check
/** Small DOM and formatting helpers. */
import { daysBetween, parseYmd } from "./core/dates.js";

/** @typedef {import("./core/types.js").Quest} Quest */

/** @param {string} sel @returns {any} */
export const $ = (sel) => document.querySelector(sel);

/**
 * Creates an element. Text is always set with textContent, never innerHTML.
 * @param {string} tag @param {string} [cls] @param {string | number | null} [text]
 * @returns {any}
 */
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

// Dates are YYYY-MM-DD strings held in UTC Date objects, so format them in UTC.
/** @param {string} d @param {Intl.DateTimeFormatOptions} opts */
const fmtYmd = (d, opts) => parseYmd(d).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
/** @param {string} d e.g. "Thu, Oct 22" */
export const fmtDay = (d) => fmtYmd(d, { weekday: "short", month: "short", day: "numeric" });
/** @param {string} d e.g. "T" */
export const fmtWeekdayNarrow = (d) => fmtYmd(d, { weekday: "narrow" });

/** @param {string} t "HH:MM" */
export function fmtTime(t) {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** @param {number} at ms since epoch */
export const fmtClock = (at) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Today", "Tomorrow", "3 days ago", "Friday", "Nov 3", plus the time. @param {Quest} q @param {string} today */
export function fmtDue(q, today) {
  if (!q.due) return "";
  const diff = daysBetween(today, q.due);
  let label =
    diff === 0 ? "Today"
    : diff === 1 ? "Tomorrow"
    : diff === -1 ? "Yesterday"
    : diff < 0 ? `${-diff} days ago`
    : diff < 7 ? fmtYmd(q.due, { weekday: "long" })
    : fmtYmd(q.due, { month: "short", day: "numeric" });
  if (q.time) label += " " + fmtTime(q.time);
  return label;
}

export const REPEAT_LABEL = /** @type {Record<string, string>} */ ({
  daily: "every day",
  weekdays: "weekdays",
  weekly: "weekly",
  monthly: "monthly",
});

/** Triggers a file download. @param {string} text @param {string} filename @param {string} type */
export function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
