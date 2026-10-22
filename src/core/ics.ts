/** iCalendar (.ics) export with alarms, so reminders work through the phone's own calendar. */
import { addDays } from "./dates";
import type { Quest, Repeat } from "./types";

const RRULE: Partial<Record<Repeat, string>> = {
  daily: "FREQ=DAILY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
};
const pad = (n: number) => String(n).padStart(2, "0");
const compact = (ymd: string) => ymd.replace(/-/g, "");

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "quest";

/** RFC 5545 text escaping. */
export const icsEscape = (s: unknown): string =>
  String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** RFC 5545 line folding at 75 octets (approximated by characters). */
export function icsFold(line: string): string {
  const out: string[] = [];
  while (line.length > 74) {
    out.push(line.slice(0, 74));
    line = " " + line.slice(74);
  }
  out.push(line);
  return out.join("\r\n");
}

/** Local date-time "YYYYMMDDTHHMM00" for a date plus minutes since midnight (may roll into the next day). */
function localDateTime(due: string, minutes: number): string {
  const day = addDays(due, Math.floor(minutes / 1440));
  const m = minutes % 1440;
  return `${compact(day)}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}

function alarmTrigger(q: Quest): string {
  // all-day events: alarms are relative to midnight, so shift to 9am
  const mins = q.time ? q.remind : q.remind - 540;
  if (mins === 0) return "TRIGGER:PT0M";
  return mins > 0 ? `TRIGGER:-PT${mins}M` : `TRIGGER:PT${-mins}M`;
}

/**
 * Builds a calendar with one event per open, scheduled quest. Timed quests become 30-minute
 * floating-time events; untimed ones become all-day events whose alarm is shifted to 9:00.
 */
export function buildIcs(quests: Quest[], now: number = Date.now()): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Quest Log//EN", "CALSCALE:GREGORIAN"];
  for (const q of quests) {
    if (!q.due || q.done) continue;
    lines.push("BEGIN:VEVENT", `UID:quest-${q.id}-${compact(q.due)}@questlog`, `DTSTAMP:${stamp}`);
    if (q.time) {
      const [h, m] = q.time.split(":").map(Number);
      const start = h * 60 + m;
      lines.push(`DTSTART:${localDateTime(q.due, start)}`, `DTEND:${localDateTime(q.due, start + 30)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(q.due)}`, `DTEND;VALUE=DATE:${compact(addDays(q.due, 1))}`);
    }
    lines.push(`SUMMARY:${icsEscape("⚔ " + q.name)}`);
    lines.push(`DESCRIPTION:${icsEscape((q.tiny ? "Tiny step: " + q.tiny + "\n" : "") + `+${q.xp} XP in Quest Log`)}`);
    const rule = RRULE[q.repeat];
    if (rule) lines.push("RRULE:" + rule);
    if (q.remind >= 0) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(q.name)}`, alarmTrigger(q), "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n");
}
