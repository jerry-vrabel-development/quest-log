/** When a quest's reminder should fire. Used by the app (while open) and the server cron (while closed). */
import { localYmd, rollForward, zonedTimeToUtc } from "./dates";
import type { Quest } from "./types";

/** No time set means 9:00 AM. */
export const DEFAULT_TIME = "09:00";
/** Stop nagging 6h after the due time. */
export const REMINDER_GRACE_MS = 6 * 3600_000;

export interface ReminderWindow {
  /** Stable per occurrence ("<id>@<date>"), so each one fires once. */
  key: string;
  at: number;
  dueAt: number;
}

export interface DueReminder {
  key: string;
  title: string;
  body: string;
}

/** The reminder window for a quest's current occurrence, or null if it has no reminder. */
export function reminderFor(q: Quest, today: string, tz: string): ReminderWindow | null {
  if (!q.due || q.done) return null;
  const { remind } = q;
  if (remind < 0) return null;
  const due = q.repeat !== "none" ? rollForward(q.due, q.repeat, today) : q.due;
  const dueAt = zonedTimeToUtc(due, q.time || DEFAULT_TIME, tz);
  return { key: `${q.id}@${due}`, at: dueAt - remind * 60_000, dueAt };
}

/** Reminders that should be showing right now. */
export function dueReminders(state: { quests?: Quest[] }, tz: string, now: number): DueReminder[] {
  const today = localYmd(now, tz);
  const out: DueReminder[] = [];
  for (const q of state.quests || []) {
    const r = reminderFor(q, today, tz);
    if (!r || now < r.at || now > r.dueAt + REMINDER_GRACE_MS) continue;
    out.push({ key: r.key, title: q.name, body: q.tiny ? "Tiny step: " + q.tiny : `+${q.xp} XP waiting` });
  }
  return out;
}
