/** Stats derived from the activity log, and the badges they unlock. */
import { MOOD_LOW, bestStreak, level, logEvent, streak } from "./rules";
import { countComebacks } from "./streaks";
import type { Mood, State, When } from "./types";

export interface Stats {
  quests: number;
  freezes: number;
  moodDays: number;
  /** Quests finished on a day the mood was MOOD_LOW or under. */
  lowDayWins: number;
  byCat: Record<string, number>;
  xpByDay: Record<string, number>;
  countByDay: Record<string, number>;
  bestStreak: number;
  /** Times activity resumed after a break. */
  comebacks: number;
  loot: number;
  legendary: number;
  level: number;
}

export type Badge = readonly [id: string, icon: string, name: string, desc: string, test: (s: Stats) => boolean];

export interface EarnedBadge {
  id: string;
  icon: string;
  name: string;
  desc: string;
}

/** Display order = this order. */
export const BADGES: readonly Badge[] = [
  ["first-step", "🥾", "First Step", "Complete your first quest", (s) => s.quests >= 1],
  ["thaw", "🧊", "Thaw", "Use the Frozen? button", (s) => s.freezes >= 1],
  ["check-in", "🫀", "Honest Check-in", "Log your mood for the first time", (s) => s.moodDays >= 1],
  ["low-day-hero", "🛡️", "Low-Day Hero", "Finish a quest on a day your mood was 4 or under", (s) => s.lowDayWins >= 1],
  ["ten-down", "🔟", "Ten Down", "Complete 10 quests", (s) => s.quests >= 10],
  ["bash-bff", "🐕", "Bash's Best Friend", "Complete 10 Bash quests", (s) => (s.byCat["Bash"] || 0) >= 10],
  ["streak-3", "🔥", "Kindling", "3-day streak", (s) => s.bestStreak >= 3],
  ["comeback", "🌱", "Comeback", "Come back after a break", (s) => s.comebacks >= 1],
  ["mood-week", "📓", "Self-Aware", "Log your mood on 7 different days", (s) => s.moodDays >= 7],
  ["streak-7", "🔥", "Campfire", "7-day streak", (s) => s.bestStreak >= 7],
  ["career-10", "💼", "Career Climber", "Complete 10 Career quests", (s) => (s.byCat["Career"] || 0) >= 10],
  ["collector", "🎒", "Collector", "Collect 25 loot items", (s) => s.loot >= 25],
  ["level-5", "⭐", "Level 5", "Reach level 5", (s) => s.level >= 5],
  ["fifty", "🏅", "Half Century", "Complete 50 quests", (s) => s.quests >= 50],
  ["lucky", "👑", "Lucky", "Find a legendary drop", (s) => s.legendary >= 1],
  ["streak-14", "🔥", "Bonfire", "14-day streak", (s) => s.bestStreak >= 14],
  ["mood-month", "🗓️", "Steady Witness", "Log your mood on 30 different days", (s) => s.moodDays >= 30],
  ["level-10", "🌟", "Level 10", "Reach level 10", (s) => s.level >= 10],
  ["centurion", "🏛️", "Centurion", "Complete 100 quests", (s) => s.quests >= 100],
  ["streak-30", "☀️", "Sunrise", "30-day streak", (s) => s.bestStreak >= 30],
];

/** The last check-in of each day. */
export function moodByDay(moods: Mood[]): Partial<Record<string, Mood>> {
  const m: Partial<Record<string, Mood>> = {};
  for (const x of [...moods].sort((a, b) => a.at - b.at)) m[x.day] = x;
  return m;
}

const bump = (obj: Record<string, number>, key: string, by = 1) => (obj[key] = (obj[key] || 0) + by);

export function computeStats(S: State, today: string): Stats {
  const quests = S.log.filter((e) => e.t === "quest");
  const byCat: Record<string, number> = {};
  const xpByDay: Record<string, number> = {};
  const countByDay: Record<string, number> = {};
  for (const e of quests) {
    bump(byCat, e.g || "Other");
    bump(countByDay, e.day);
  }
  for (const e of S.log) if (e.xp) bump(xpByDay, e.day, e.xp);
  const moods = moodByDay(S.moods);
  return {
    quests: quests.length,
    freezes: S.log.filter((e) => e.t === "freeze").length,
    moodDays: Object.keys(moods).length,
    lowDayWins: quests.filter((e) => (moods[e.day]?.v ?? Infinity) <= MOOD_LOW).length,
    byCat,
    xpByDay,
    countByDay,
    bestStreak: Math.max(bestStreak(S.days), streak(S.days, today)),
    comebacks: countComebacks(S.days),
    loot: S.inv.length,
    legendary: S.inv.filter((i) => i.rar === "legendary").length,
    level: level(S.xp).l,
  };
}

/** Awards any badges whose test now passes. Mutates S.badges and logs each new badge. */
export function checkBadges(S: State, when: When): EarnedBadge[] {
  const st = computeStats(S, when.today);
  const earned: EarnedBadge[] = [];
  for (const [id, icon, name, desc, test] of BADGES) {
    if (S.badges[id] || !test(st)) continue;
    S.badges[id] = when.now;
    earned.push({ id, icon, name, desc });
    logEvent(S, { t: "badge", name }, when);
  }
  return earned;
}
