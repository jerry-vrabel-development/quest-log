/**
 * The "Frozen?" dice: when choosing is the hard part, let the dice choose.
 * It only ever offers small things: the tiny first steps of open quests that are due now
 * (or anytime), never a whole quest, falling back to a few universal micro-steps.
 */
import type { Quest } from "./types";

export interface DicePick {
  /** What to do for two minutes. */
  step: string;
  /** The quest it starts, if it came from one. */
  questId?: number;
  questName?: string;
}

/** Always-available micro-steps for when no quest has a tiny step ready. */
export const FALLBACK_STEPS: readonly string[] = [
  "Drink a glass of water",
  "Stand up and stretch for one minute",
  "Step outside for two minutes",
  "Put three things back where they belong",
  "Open the window and take five slow breaths",
  "Write one sentence about how you feel",
];

/** Tiny steps worth offering right now: open quests that are overdue, due today, or anytime. */
export function diceCandidates(quests: Quest[], today: string): DicePick[] {
  const fromQuests = quests
    .filter((q) => !q.done && q.tiny.trim() && (!q.due || q.due <= today))
    .map((q) => ({ step: q.tiny.trim(), questId: q.id, questName: q.name }));
  return fromQuests.length ? fromQuests : FALLBACK_STEPS.map((step) => ({ step }));
}

/**
 * Picks one candidate at random, never repeating the previous pick when there's a choice
 * (so "Roll again" always changes something).
 */
export function roll(candidates: DicePick[], rng: () => number = Math.random, previous?: DicePick): DicePick {
  if (!candidates.length) throw new Error("roll needs at least one candidate");
  const pool = candidates.length > 1 && previous ? candidates.filter((c) => c.step !== previous.step) : candidates;
  return pool[Math.floor(rng() * pool.length)] ?? candidates[0];
}

/** Which face the die shows (1-6). Cosmetic, but never the same face twice in a row. */
export function rollFace(rng: () => number = Math.random, previous?: number): number {
  const faces = [1, 2, 3, 4, 5, 6].filter((f) => f !== previous);
  return faces[Math.floor(rng() * faces.length)] ?? 1;
}
