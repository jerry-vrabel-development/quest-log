// @ts-check
/** When a quest's reminder should fire. Used by the app (while open) and the server cron (while closed). */
import { localYmd, rollForward, zonedTimeToUtc } from "./dates.js";

/** @typedef {import("./types.js").Quest} Quest */

export const DEFAULT_TIME = "09:00"; // no time set means 9:00 AM
export const REMINDER_GRACE_MS = 6 * 3600_000; // stop nagging 6h after the due time

/**
 * The reminder window for a quest's current occurrence, or null if it has no reminder.
 * @param {Quest} q @param {string} today @param {string} tz
 * @returns {{ key: string, at: number, dueAt: number } | null}
 */
export function reminderFor(q, today, tz) {
  if (!q.due || q.done) return null;
  const remind = q.remind ?? 0;
  if (remind < 0) return null;
  const due = q.repeat && q.repeat !== "none" ? rollForward(q.due, q.repeat, today) : q.due;
  const dueAt = zonedTimeToUtc(due, q.time || DEFAULT_TIME, tz);
  return { key: `${q.id}@${due}`, at: dueAt - remind * 60_000, dueAt };
}

/**
 * Reminders that should be showing right now. Each has a stable key so it fires once.
 * @param {{ quests?: Quest[] }} state @param {string} tz @param {number} now
 */
export function dueReminders(state, tz, now) {
  const today = localYmd(now, tz);
  const out = [];
  for (const q of state.quests || []) {
    const r = reminderFor(q, today, tz);
    if (!r || now < r.at || now > r.dueAt + REMINDER_GRACE_MS) continue;
    out.push({ key: r.key, title: q.name, body: q.tiny ? "Tiny step: " + q.tiny : `+${q.xp} XP waiting` });
  }
  return out;
}
