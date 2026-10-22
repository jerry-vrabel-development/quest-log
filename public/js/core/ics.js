// @ts-check
/** iCalendar (.ics) export with alarms, so reminders work through the phone's own calendar. */
import { addDays } from "./dates.js";

/** @typedef {import("./types.js").Quest} Quest */

const RRULE = {
  daily: "FREQ=DAILY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
};
const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");

/** @param {string} s */
export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "quest";

/** RFC 5545 text escaping. @param {unknown} s */
export const icsEscape = (s) =>
  String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** RFC 5545 line folding at 75 octets (approximated by characters). @param {string} line */
export function icsFold(line) {
  const out = [];
  while (line.length > 74) {
    out.push(line.slice(0, 74));
    line = " " + line.slice(74);
  }
  out.push(line);
  return out.join("\r\n");
}

/**
 * Builds a calendar with one event per open, scheduled quest. Timed quests become 30-minute
 * floating-time events; untimed ones become all-day events whose alarm is shifted to 9:00.
 * @param {Quest[]} quests @param {number} [now]
 */
export function buildIcs(quests, now = Date.now()) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Quest Log//EN", "CALSCALE:GREGORIAN"];
  for (const q of quests) {
    if (!q.due || q.done) continue;
    const d = q.due.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:quest-${q.id}-${d}@questlog`, `DTSTAMP:${stamp}`);
    if (q.time) {
      const [h, m] = q.time.split(":").map(Number);
      const endMin = h * 60 + m + 30;
      const end =
        endMin >= 1440 ?
          `${addDays(q.due, 1).replace(/-/g, "")}T${pad(Math.floor((endMin - 1440) / 60))}${pad(endMin % 60)}00`
        : `${d}T${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`;
      lines.push(`DTSTART:${d}T${pad(h)}${pad(m)}00`, `DTEND:${end}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${addDays(q.due, 1).replace(/-/g, "")}`);
    }
    lines.push(`SUMMARY:${icsEscape("⚔ " + q.name)}`);
    lines.push(`DESCRIPTION:${icsEscape((q.tiny ? "Tiny step: " + q.tiny + "\n" : "") + `+${q.xp} XP in Quest Log`)}`);
    const rule = RRULE[/** @type {keyof typeof RRULE} */ (q.repeat)];
    if (rule) lines.push("RRULE:" + rule);
    if (q.remind >= 0) {
      // all-day events: alarms are relative to midnight, so shift to 9am
      const mins = q.time ? q.remind : q.remind - 540;
      const trigger =
        mins === 0 ? "TRIGGER:PT0M"
        : mins > 0 ? `TRIGGER:-PT${mins}M`
        : `TRIGGER:PT${-mins}M`;
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(q.name)}`, trigger, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n");
}
