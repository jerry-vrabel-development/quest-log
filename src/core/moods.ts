/**
 * Editing and deleting mood check-ins.
 *
 * A check-in lives in two places: `S.moods` (the record charts and stats read) and a "mood"
 * event in `S.log` (the activity history). Both carry the same `at` timestamp, which is how a
 * check-in is identified. The log is capped, so an old check-in may have no log event left;
 * every rule here works with or without one.
 *
 * XP stays honest: only the first check-in of a day earns MOOD_XP (see recordMood). Deleting
 * that one moves the reward to the next check-in of the day if there is one; deleting the only
 * check-in of a day takes the reward back.
 */
import { MOOD_XP } from "./rules";
import type { LogEvent, Mood, State } from "./types";

export const NOTE_MAX = 280;

type MoodEvent = Extract<LogEvent, { t: "mood" }>;

const isMoodEvent = (e: LogEvent, at: number): e is MoodEvent => e.t === "mood" && e.at === at;
const findEvent = (S: State, at: number): MoodEvent | undefined => S.log.find((e) => isMoodEvent(e, at));

/** A mood value must be a whole number from 1 to 10. */
export const isMoodValue = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10;

/** Changes a check-in's value and note. Returns false if there is no check-in at that time. */
export function editMood(S: State, at: number, { v, note }: { v: number; note: string }): boolean {
  if (!isMoodValue(v)) throw new RangeError(`mood must be 1-10, got ${String(v)}`);
  const mood = S.moods.find((m) => m.at === at);
  if (!mood) return false;
  const clean = note.trim().slice(0, NOTE_MAX);
  mood.v = v;
  mood.note = clean;
  const e = findEvent(S, at);
  if (e) {
    e.v = v;
    e.note = clean;
  }
  return true;
}

const earliest = (moods: Mood[]): Mood | undefined =>
  moods.reduce<Mood | undefined>((a, m) => (!a || m.at < a.at ? m : a), undefined);

/**
 * Deletes a check-in. Returns the change to total XP: 0 when the day's reward moved to another
 * check-in (or this one never had it), -MOOD_XP when the day's only paid check-in is gone,
 * and null if there is no check-in at that time.
 */
export function deleteMood(S: State, at: number): { xpChange: number } | null {
  const mood = S.moods.find((m) => m.at === at);
  if (!mood) return null;
  const sameDay = S.moods.filter((m) => m.day === mood.day);
  const wasPaid = earliest(sameDay) === mood;
  const paidXp = findEvent(S, at)?.xp ?? (wasPaid ? MOOD_XP : 0);

  S.moods = S.moods.filter((m) => m !== mood);
  S.log = S.log.filter((e) => !isMoodEvent(e, at));
  if (!paidXp) return { xpChange: 0 };

  const next = earliest(sameDay.filter((m) => m !== mood));
  if (next) {
    // The next check-in of the day becomes the paid one; total XP doesn't change.
    const e = findEvent(S, next.at);
    if (e) e.xp = paidXp;
    return { xpChange: 0 };
  }
  S.xp = Math.max(0, S.xp - paidXp);
  return { xpChange: -paidXp };
}
