// @ts-check
/** Stats derived from the activity log, and the badges they unlock. */
import { MOOD_LOW, bestStreak, level, logEvent, streak } from "./rules.js";

/** @typedef {import("./types.js").State} State */
/** @typedef {import("./types.js").Mood} Mood */

/**
 * @typedef {Object} Stats
 * @property {number} quests
 * @property {number} freezes
 * @property {number} moodDays
 * @property {number} lowDayWins   quests finished on a day the mood was MOOD_LOW or under
 * @property {Record<string, number>} byCat
 * @property {Record<string, number>} xpByDay
 * @property {Record<string, number>} countByDay
 * @property {number} bestStreak
 * @property {number} loot
 * @property {number} legendary
 * @property {number} level
 */

/** @typedef {[id: string, icon: string, name: string, desc: string, test: (s: Stats) => boolean]} Badge */

/** Display order = this order. @type {Badge[]} */
export const BADGES = [
  ["first-step", "🥾", "First Step", "Complete your first quest", (s) => s.quests >= 1],
  ["thaw", "🧊", "Thaw", "Use the Frozen? button", (s) => s.freezes >= 1],
  ["check-in", "🫀", "Honest Check-in", "Log your mood for the first time", (s) => s.moodDays >= 1],
  ["low-day-hero", "🛡️", "Low-Day Hero", "Finish a quest on a day your mood was 4 or under", (s) => s.lowDayWins >= 1],
  ["ten-down", "🔟", "Ten Down", "Complete 10 quests", (s) => s.quests >= 10],
  ["bash-bff", "🐕", "Bash's Best Friend", "Complete 10 Bash quests", (s) => (s.byCat["Bash"] || 0) >= 10],
  ["streak-3", "🔥", "Kindling", "3-day streak", (s) => s.bestStreak >= 3],
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

/** The last check-in of each day. @param {Mood[]} moods @returns {Record<string, Mood>} */
export function moodByDay(moods) {
  /** @type {Record<string, Mood>} */
  const m = {};
  [...moods].sort((a, b) => a.at - b.at).forEach((x) => (m[x.day] = x));
  return m;
}

/** @param {Record<string, number>} obj @param {string} key @param {number} [by] */
const bump = (obj, key, by = 1) => (obj[key] = (obj[key] || 0) + by);

/** @param {State} S @param {string} today @returns {Stats} */
export function computeStats(S, today) {
  const quests = S.log.filter((e) => e.t === "quest");
  /** @type {Record<string, number>} */ const byCat = {};
  /** @type {Record<string, number>} */ const xpByDay = {};
  /** @type {Record<string, number>} */ const countByDay = {};
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
    lowDayWins: quests.filter((e) => moods[e.day] && moods[e.day].v <= MOOD_LOW).length,
    byCat,
    xpByDay,
    countByDay,
    bestStreak: Math.max(bestStreak(S.days), streak(S.days, today)),
    loot: S.inv.length,
    legendary: S.inv.filter((i) => i.rar === "legendary").length,
    level: level(S.xp).l,
  };
}

/**
 * Awards any badges whose test now passes. Mutates S.badges and logs each new badge.
 * @param {State} S @param {{ today: string, now: number }} when
 */
export function checkBadges(S, when) {
  const st = computeStats(S, when.today);
  const earned = [];
  for (const [id, icon, name, desc, test] of BADGES) {
    if (S.badges[id] || !test(st)) continue;
    S.badges[id] = when.now;
    earned.push({ id, icon, name, desc });
    logEvent(S, { t: "badge", name }, when);
  }
  return earned;
}
