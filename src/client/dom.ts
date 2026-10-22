/** Small DOM and formatting helpers. */
import { daysBetween, parseYmd } from "../core/dates";
import type { Quest } from "../core/types";

/**
 * Looks up an element that the page is known to contain; throws if the markup changed.
 * T is a typed cast by design: the selector, not the compiler, knows what element it finds.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function $<T extends Element = HTMLElement>(sel: string): T {
  const e = document.querySelector<T>(sel);
  if (!e) throw new Error(`Missing element: ${sel}`);
  return e;
}

/** Creates an element. Text is always set with textContent, never innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string | number | null,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

// Dates are YYYY-MM-DD strings held in UTC Date objects, so format them in UTC.
const fmtYmd = (d: string, opts: Intl.DateTimeFormatOptions) =>
  parseYmd(d).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });

/** e.g. "Thu, Oct 22" */
export const fmtDay = (d: string) => fmtYmd(d, { weekday: "short", month: "short", day: "numeric" });
/** e.g. "T" */
export const fmtWeekdayNarrow = (d: string) => fmtYmd(d, { weekday: "narrow" });

/** "HH:MM" → "9:30 AM" in the user's locale. */
export function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A timestamp as a short local clock time. */
export const fmtClock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Today", "Tomorrow", "3 days ago", "Friday", "Nov 3", plus the time. */
export function fmtDue(q: Quest, today: string): string {
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

export const REPEAT_LABEL: Record<string, string> = {
  daily: "every day",
  weekdays: "weekdays",
  weekly: "weekly",
  monthly: "monthly",
};

/** Triggers a file download. */
export function download(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
