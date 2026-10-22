// @ts-check
/**
 * Game rules: XP curve, streaks, the loot schedule, and what completing a quest or
 * logging a mood does to the state. Pure functions over a State object, used by both
 * the app and the MCP server so the two can never disagree.
 */
import { addDays, nextOccurrence } from "./dates.js";

/** @typedef {import("./types.js").State} State */
/** @typedef {import("./types.js").Quest} Quest */
/** @typedef {import("./types.js").LootItem} LootItem */
/** @typedef {import("./types.js").Rarity} Rarity */

export const XP_VALUES = [5, 10, 15, 20, 25, 30, 50];
export const DEFAULT_XP = 15;
export const FREEZE_XP = 5;
export const MOOD_XP = 5; // same reward whatever the mood: honesty is the quest
export const MOOD_LOW = 4; // 4 and under counts as a low day
export const PITY_AFTER = 3; // guaranteed drop after this many dry completions
const KEEP_DAYS = 120;
const KEEP_LOG = 3000;
const KEEP_INV = 300;

// 1-10 scale. The ends are bookends: you can always go lower, and 10 is mostly theoretical.
export const MOODS = ["Bottom", "Awful", "Rough", "Low", "Meh", "Okay", "Decent", "Good", "Great", "Peak"].map(
  (label, i) => ({ v: i + 1, label }),
);
/** @param {number} v */
export const moodLabel = (v) => MOODS[v - 1]?.label ?? "";

/** @type {Record<Rarity, [string, string][]>} */
export const LOOT = {
  common: [
    ["Bash's Squeaky Ball", "Reward: 10 minutes of guilt-free anything."],
    ["Cup of Good Coffee", "Reward: make or buy the good stuff."],
    ["Small Win Token", "Proof that you moved. That counts."],
    ["Extra Belly Rub", "For Bash. Also kind of for you."],
    ["Clean Commit", "Something got shipped today."],
    ["Open Tab Closed", "One less thing rattling around."],
  ],
  rare: [
    ["Golden Tennis Ball", "Reward: a longer walk somewhere you like."],
    ["Thaw Crystal", "The freeze cracked. Remember how that felt."],
    ["Recruiter's Eye", "You know how hiring works from both sides."],
    ["Mechanical Keyboard of Focus", "Reward: 30 minutes on a fun code side project."],
    ["Good Playlist", "Reward: put on something you love while you work."],
  ],
  epic: [
    ["Employee #75 Badge", "You were there early. You know how to start from small."],
    ["Dot-Com Survivor Shield", "You've rebuilt after a crash before."],
    ["Treat of Champions", "Reward: get yourself a real treat. Bash too."],
  ],
  legendary: [["Crown of Forward Motion", "Reward: a full afternoon off, zero guilt. You earned it."]],
};

/**
 * Cumulative drop chances: 3% legendary, 8% epic, 17% rare, 27% common, 45% nothing.
 * @type {[number, Rarity][]}
 */
export const DROP_TABLE = [
  [0.03, "legendary"],
  [0.11, "epic"],
  [0.28, "rare"],
  [0.55, "common"],
];

/** Level curve: 50 XP for level 2, each level needs 25% more. @param {number} xp */
export function level(xp) {
  let l = 1;
  let need = 50;
  let acc = 0;
  while (xp >= acc + need) {
    acc += need;
    l++;
    need = Math.round(need * 1.25);
  }
  return { l, into: xp - acc, need };
}

/**
 * Gentle streak: counts back from today, or from yesterday if today has no activity yet,
 * so the morning never reads as "broken".
 * @param {string[]} days @param {string} today
 */
export function streak(days, today) {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Longest run of consecutive active days ever. @param {string[]} days */
export function bestStreak(days) {
  let best = 0;
  let run = 0;
  /** @type {string|null} */
  let prev = null;
  for (const d of [...new Set(days)].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** @param {State} S @param {string} today */
export function markActiveDay(S, today) {
  if (!S.days.includes(today)) {
    S.days.push(today);
    S.days = S.days.slice(-KEEP_DAYS);
  }
}

/**
 * Variable-ratio loot roll with a pity timer. Mutates S.inv and S.dry.
 * @param {State} S
 * @param {() => number} [rng] returns [0, 1); injectable for tests
 * @param {number} [now]
 * @returns {LootItem | null}
 */
export function rollLoot(S, rng = Math.random, now = Date.now()) {
  const r = rng();
  /** @type {Rarity | null} */
  let rar = DROP_TABLE.find(([p]) => r < p)?.[1] ?? null;
  if (!rar && S.dry >= PITY_AFTER) rar = "common";
  if (!rar) {
    S.dry++;
    return null;
  }
  S.dry = 0;
  const pool = LOOT[rar];
  const [n, d] = pool[Math.floor(rng() * pool.length)];
  const item = { rar, n, d, at: now };
  S.inv.unshift(item);
  S.inv = S.inv.slice(0, KEEP_INV);
  return item;
}

/** @param {State} S @param {Omit<import("./types.js").LogEvent, "at" | "day">} e @param {{today: string, now: number}} when */
export function logEvent(S, e, { today, now }) {
  S.log.unshift({ at: now, day: today, ...e });
  S.log = S.log.slice(0, KEEP_LOG);
}

/** @param {State} S @param {number} xp @param {string} today */
function addXp(S, xp, today) {
  S.xp = Math.max(0, (S.xp || 0) + xp);
  if (xp > 0) markActiveDay(S, today);
}

/**
 * Completes a quest: logs it, adds XP, marks the day active, and either rolls a repeating
 * quest forward or marks a one-off as done. Loot is rolled separately by the caller.
 * @param {State} S @param {Quest} q
 * @param {{ today: string, now: number, via?: string }} opts
 * @returns {{ xp: number, nextDue: string | null }}
 */
export function completeQuest(S, q, { today, now, via }) {
  logEvent(S, { t: "quest", id: q.id, name: q.name, g: q.g, xp: q.xp, ...(via ? { via } : {}) }, { today, now });
  addXp(S, q.xp, today);
  if (q.repeat && q.repeat !== "none" && q.due) {
    q.count = (q.count || 0) + 1;
    q.due = nextOccurrence(q.due, q.repeat, today);
    return { xp: q.xp, nextDue: q.due };
  }
  q.done = true;
  q.doneAt = now;
  return { xp: q.xp, nextDue: null };
}

/** Un-checks a one-off quest and takes its XP back. @param {State} S @param {Quest} q */
export function uncompleteQuest(S, q) {
  const i = S.log.findIndex((e) => e.t === "quest" && e.id === q.id);
  if (i >= 0) S.log.splice(i, 1);
  q.done = false;
  q.doneAt = null;
  S.xp = Math.max(0, (S.xp || 0) - q.xp);
}

/**
 * Records a mood check-in. Only the first check-in of a day earns XP.
 * @param {State} S @param {number} v @param {string} note
 * @param {{ today: string, now: number, via?: string }} opts
 */
export function recordMood(S, v, note, { today, now, via }) {
  const first = !S.moods.some((m) => m.day === today);
  const xp = first ? MOOD_XP : 0;
  const extra = via ? { via } : {};
  S.moods.push({ at: now, day: today, v, s: 10, note, ...extra });
  logEvent(S, { t: "mood", v, s: 10, note, xp, ...extra }, { today, now });
  addXp(S, xp, today);
  return { first, xp };
}

/** The "Frozen?" button: two minutes of the smallest step is worth a little XP. @param {State} S @param {{today: string, now: number}} when */
export function recordFreeze(S, when) {
  logEvent(S, { t: "freeze", xp: FREEZE_XP }, when);
  addXp(S, FREEZE_XP, when.today);
  return { xp: FREEZE_XP };
}

/** Queues XP earned outside the app so the app can roll loot for it later. @param {State} S @param {string} name @param {number} xp @param {number} now */
export function queueReward(S, name, xp, now) {
  (S.rewards = S.rewards || []).push({ name, xp, at: now });
}
