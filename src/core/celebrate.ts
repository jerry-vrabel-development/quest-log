/**
 * How big a moment is, and whether it pays out for sure. Pure rules, following Karen Pryor's
 * training principles:
 *
 *  - Mark the behavior instantly (the client plays a marker click before anything else).
 *  - New behaviors get continuous reinforcement: a repeating quest's first completions always drop loot.
 *  - Hard moments pay more: on a low-mood day every quest drops loot, and the first one is a jackpot.
 *  - Jackpots are rare and big, saved for breakthroughs: level-ups, badges, epic loot, big quests,
 *    big days, streak milestones, and comebacks.
 *  - Never punishing: coming back after a break always pays, and the streak that ended is honored.
 */
import { MOOD_LOW, newTitle } from "./rules";
import { honorEndedRun, type Comeback } from "./streaks";
import type { LootItem, Mood } from "./types";

export type Tier = "small" | "good" | "jackpot";

/** A repeating quest's first completions always drop loot, while the habit forms. */
export const HABIT_WARMUP = 5;
/** XP at or above this makes a quest "big". */
export const BIG_QUEST_XP = 30;
/** The 5th, 10th, ... quest of a day is a big day. */
export const BIG_DAY_EVERY = 5;
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365] as const;

export interface Moment {
  kind: "quest" | "mood" | "freeze";
  xp: number;
  /** XP of the quest itself (quests only). */
  questXp?: number;
  item: LootItem | null;
  badges: string[];
  levelBefore: number;
  levelAfter: number;
  streakBefore: number;
  streakAfter: number;
  /** Quests completed today, including this one. */
  questsToday: number;
  /** Today's latest mood is at or under MOOD_LOW. */
  lowDay: boolean;
  /** Set when this is the first rewarded action after one or more days off. */
  comeback?: Comeback | null;
}

export interface Celebration {
  tier: Tier;
  /** Why it's big, most important first. Empty for small moments. */
  reasons: string[];
}

/** Today's latest mood is low. */
export function isLowDay(moods: Mood[], today: string): boolean {
  const last = moods.filter((m) => m.day === today).at(-1);
  return !!last && last.v <= MOOD_LOW;
}

/** Whether this completion is guaranteed to drop loot (continuous reinforcement). */
export function guaranteedDrop({
  repeatCount,
  lowDay,
  comeback = false,
}: {
  repeatCount: number;
  lowDay: boolean;
  comeback?: boolean;
}): boolean {
  return comeback || lowDay || (repeatCount > 0 && repeatCount <= HABIT_WARMUP);
}

const crossed = (before: number, after: number) => STREAK_MILESTONES.find((m) => before < m && after >= m);

export function celebrationFor(m: Moment): Celebration {
  const reasons: string[] = [];
  if (m.comeback) {
    reasons.push("Comeback! Welcome back.");
    const honor = honorEndedRun(m.comeback);
    if (honor) reasons.push(honor);
  }
  if (m.levelAfter > m.levelBefore) {
    const title = newTitle(m.levelBefore, m.levelAfter);
    reasons.push(title ? `Level ${m.levelAfter}: you're a ${title} now!` : `Level ${m.levelAfter}!`);
  }
  if (m.item?.rar === "legendary") reasons.push("Legendary drop!");
  else if (m.item?.rar === "epic") reasons.push("Epic drop!");
  for (const b of m.badges) reasons.push(`Badge: ${b}`);
  const milestone = crossed(m.streakBefore, m.streakAfter);
  if (milestone) reasons.push(`${milestone}-day streak!`);
  if (m.kind === "quest") {
    if (m.lowDay && m.questsToday === 1) reasons.push("You moved on a hard day.");
    if (m.questsToday >= BIG_DAY_EVERY && m.questsToday % BIG_DAY_EVERY === 0) {
      reasons.push(`Big day: ${m.questsToday} quests!`);
    }
    if ((m.questXp ?? 0) >= BIG_QUEST_XP) reasons.push("Big quest done!");
  }
  if (reasons.length) return { tier: "jackpot", reasons };
  if (m.item || m.xp >= 20) return { tier: "good", reasons };
  return { tier: "small", reasons };
}
