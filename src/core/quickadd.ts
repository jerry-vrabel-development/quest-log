/**
 * Smart quick-add (#79): "Call dentist tomorrow 10am" → name "Call dentist", due tomorrow, 10:00.
 *
 * Pure and on the device: no AI, no network, no clock (today is passed in). It only recognizes
 * dates, times and repeats it's sure about; every other word stays in the name, and the app shows
 * what it understood before anything changes, so it never guesses silently.
 */
import { addDays, parseYmd } from "./dates";
import type { Repeat } from "./types";

export interface QuickAdd {
  name: string;
  due?: string;
  time?: string;
  repeat?: Repeat;
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
// Full names and common short forms, longest first so "thursday" wins over "thu".
const DAY_WORD =
  "(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)";

const dayIndex = (word: string): number => {
  const w = word.toLowerCase();
  return DAY_NAMES.findIndex((d) => d.startsWith(w.slice(0, 3)));
};
const weekday = (ymd: string): number => parseYmd(ymd).getUTCDay();

/** The next date that falls on `day` (0 = Sunday): today counts only when `includeToday`. */
function nextDay(today: string, day: number, includeToday: boolean): string {
  let diff = (day - weekday(today) + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDays(today, diff);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 24-hour "HH:MM", or null if it isn't a real time. A bare hour guesses the likely half of the day. */
function toTime(hourText: string, minText: string | undefined, ampm: string | undefined): string | null {
  let h = Number(hourText);
  const m = minText ? Number(minText) : 0;
  if (!Number.isInteger(h) || m > 59) return null;
  const mer = ampm?.toLowerCase().replace(/\./g, "");
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
  } else if (h >= 1 && h <= 7) {
    h += 12; // "at 3" means 3 PM; nobody schedules 3 AM by accident
  } else if (h > 23) {
    return null;
  }
  return `${pad(h)}:${pad(m)}`;
}

export function parseQuickAdd(input: string, today: string): QuickAdd {
  let text = ` ${input} `;
  const out: Omit<QuickAdd, "name"> = {};
  /** Removes the first match of `re` and returns its groups. */
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(text);
    if (m) text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
    return m;
  };

  // Repeats
  if (take(/\s(every\s*day|each\s+day|daily)(?=\s)/i)) out.repeat = "daily";
  else if (take(/\s(every\s+week\s*day|every\s+workday|weekdays|on\s+weekdays)(?=\s)/i)) out.repeat = "weekdays";
  else {
    const m = take(new RegExp(String.raw`\s(?:every|each)\s+${DAY_WORD}(?=\s)`, "i"));
    if (m?.[1]) {
      out.repeat = "weekly";
      out.due = nextDay(today, dayIndex(m[1]), true);
    } else if (take(/\s(every\s+week|each\s+week|weekly)(?=\s)/i)) out.repeat = "weekly";
    else if (take(/\s(every\s+month|each\s+month|monthly)(?=\s)/i)) out.repeat = "monthly";
  }

  // Dates
  if (!out.due) {
    if (take(/\s(today|tonight|this\s+evening)(?=\s)/i)) out.due = today;
    else if (take(/\s(tomorrow|tmrw|tmw)(?=\s)/i)) out.due = addDays(today, 1);
    else if (take(/\snext\s+week(?=\s)/i)) out.due = addDays(today, 7);
    else {
      const inDays = take(/\sin\s+(\d{1,3})\s+days?(?=\s)/i);
      if (inDays?.[1]) out.due = addDays(today, Number(inDays[1]));
      else {
        const m = take(new RegExp(String.raw`\s(?:on\s+|next\s+|this\s+)?${DAY_WORD}(?=\s)`, "i"));
        if (m?.[1]) out.due = nextDay(today, dayIndex(m[1]), false);
      }
    }
  }

  // Times
  if (take(/\s(?:at\s+)?noon(?=\s)/i)) out.time = "12:00";
  else {
    const withMer = new RegExp(String.raw`\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$)`, "i");
    const bare = /\s(?:at\s+)(\d{1,2})(?::(\d{2}))?(?=\s)/i;
    const clock = /\s(\d{1,2}):(\d{2})(?=\s)/i;
    for (const re of [withMer, bare, clock]) {
      const m = re.exec(text);
      const t = m?.[1] ? toTime(m[1], m[2], m[3]) : null;
      if (m && t) {
        take(re);
        out.time = t;
        break;
      }
    }
  }

  // A time or a repeat with no date starts today (repeating quests need a start date).
  if (!out.due && (out.time || out.repeat)) out.due = today;

  const name = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,;:-]+$/, "")
    .replace(/\s+(at|on|by|every|each|this|next|in)$/i, "")
    .replace(/^(at|on|by)\s+/i, "")
    .trim();
  return { name: name.charAt(0).toUpperCase() + name.slice(1), ...out };
}

/** True when the parse found anything worth offering. */
export const understoodSomething = (q: QuickAdd): boolean => !!(q.due || q.time || q.repeat);

const REPEAT_WORDS: Record<Repeat, string> = {
  none: "",
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Every week",
  monthly: "Every month",
};

/** "Tomorrow · 10:00 AM", "Weekdays, from today · 9:00 AM", "Fri, Oct 30". */
export function describeQuickAdd(q: QuickAdd, today: string): string {
  const parts: string[] = [];
  const day =
    !q.due ? ""
    : q.due === today ? "Today"
    : q.due === addDays(today, 1) ? "Tomorrow"
    : parseYmd(q.due).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
  if (q.repeat && q.repeat !== "none") {
    const every =
      q.repeat === "weekly" && q.due ?
        `Every ${parseYmd(q.due).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}`
      : REPEAT_WORDS[q.repeat];
    parts.push(
      day && day !== "Today" ? `${every}, from ${day.toLowerCase().startsWith("tomorrow") ? "tomorrow" : day}` : every,
    );
  } else if (day) parts.push(day);
  if (q.time) {
    const [h = 0, m = 0] = q.time.split(":").map(Number);
    const h12 = h % 12 || 12;
    parts.push(`${String(h12)}:${pad(m)} ${h < 12 ? "AM" : "PM"}`);
  }
  return parts.join(" · ");
}
