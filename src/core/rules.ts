/**
 * Game rules: XP curve, streaks, the loot schedule, and what completing a quest or
 * logging a mood does to the state. Pure functions over a State object, used by both
 * the app and the MCP server so the two can never disagree.
 */
import type { Extras } from "./checkin";
import { LEGENDARY, PACKS, poolFor, type CompanionId } from "./party";
import { addDays, nextOccurrence } from "./dates";
import type { LogEvent, LootItem, Quest, Rarity, State, When } from "./types";

export const XP_VALUES = [5, 10, 15, 20, 25, 30, 50] as const;
export const DEFAULT_XP = 15;
export const FREEZE_XP = 5;
/** Same reward whatever the mood: honesty is the quest. */
export const MOOD_XP = 5;
/** 4 and under counts as a low day. */
export const MOOD_LOW = 4;
/** Guaranteed drop after this many dry completions. */
export const PITY_AFTER = 3;
const KEEP_DAYS = 120;
const KEEP_LOG = 3000;
const KEEP_INV = 300;

/** 1-10 scale. The ends are bookends: you can always go lower, and 10 is mostly theoretical. */
export const MOODS = ["Bottom", "Awful", "Rough", "Low", "Meh", "Okay", "Decent", "Good", "Great", "Peak"].map(
  (label, i) => ({ v: i + 1, label }),
);
export const moodLabel = (v: number): string => MOODS[v - 1]?.label ?? "";

/** The Guide's pack plus the shared legendaries: the loot for anything without its own companion (#31). */
export const LOOT: Record<Rarity, readonly (readonly [name: string, desc: string])[]> = {
  ...PACKS.guide,
  legendary: LEGENDARY,
};

/** Cumulative drop chances: 3% legendary, 8% epic, 17% rare, 27% common, 45% nothing. */
export const DROP_TABLE: readonly (readonly [threshold: number, rarity: Rarity])[] = [
  [0.03, "legendary"],
  [0.11, "epic"],
  [0.28, "rare"],
  [0.55, "common"],
];

export type Rng = () => number;

/** Level curve: 50 XP for level 2, each level needs 25% more. */
/** Titles that go with levels, on the same trail theme as the loot: from this level on, you're a … */
export const LEVEL_TITLES: readonly (readonly [from: number, title: string])[] = [
  [1, "Wanderer"],
  [3, "Trailfinder"],
  [5, "Pathkeeper"],
  [8, "Wayfarer"],
  [10, "Trailblazer"],
  [15, "Cartographer"],
  [20, "Lorekeeper"],
  [30, "Legend"],
];

/** The title for a level, e.g. 13 → "Trailblazer". */
export function levelTitle(l: number): string {
  let title = LEVEL_TITLES[0][1];
  for (const [from, t] of LEVEL_TITLES) if (l >= from) title = t;
  return title;
}

/** The new title earned by going from one level to another, or null if the title didn't change. */
export function newTitle(before: number, after: number): string | null {
  return after > before && levelTitle(after) !== levelTitle(before) ? levelTitle(after) : null;
}

export function level(xp: number): { l: number; into: number; need: number } {
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
 */
export function streak(days: string[], today: string): number {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Longest run of consecutive active days ever. */
export function bestStreak(days: string[]): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...new Set(days)].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function markActiveDay(S: State, today: string): void {
  if (!S.days.includes(today)) {
    S.days.push(today);
    S.days = S.days.slice(-KEEP_DAYS);
  }
}

/**
 * One item from the pack, never one of the last (pack size - 1) found from that same pack, so you
 * see every item before any comes back. Worked out from the inventory: nothing extra to store or sync.
 */
function pickFresh(S: State, by: CompanionId, rar: Rarity, rng: Rng): readonly [string, string] {
  const pool = poolFor(by, rar);
  const shared = rar === "legendary";
  const recent = new Set(
    S.inv
      .filter((it) => it.rar === rar && (shared || it.by === by))
      .slice(0, pool.length - 1)
      .map((it) => it.n),
  );
  const fresh = pool.filter(([n]) => !recent.has(n));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(rng() * from.length)] ?? pool[0];
}

/** Variable-ratio loot roll with a pity timer. Mutates S.inv and S.dry. */
/**
 * @param guaranteed continuous reinforcement: always drop something (at least common), e.g. while a
 *   new habit forms or on a low-mood day. Rarer drops are still possible.
 */
export function rollLoot(
  S: State,
  rng: Rng = Math.random,
  now: number = Date.now(),
  guaranteed = false,
  by: CompanionId = "guide",
): LootItem | null {
  const r = rng();
  let rar: Rarity | null = DROP_TABLE.find(([p]) => r < p)?.[1] ?? null;
  if (!rar && (guaranteed || S.dry >= PITY_AFTER)) rar = "common";
  if (!rar) {
    S.dry++;
    return null;
  }
  S.dry = 0;
  const [n, d] = pickFresh(S, by, rar, rng);
  const item: LootItem = { rar, n, d, at: now, by };
  S.inv.unshift(item);
  S.inv = S.inv.slice(0, KEEP_INV);
  return item;
}

/** Distributes Omit over each member of a union, so each event keeps its own fields. */
type NewEvent =
  LogEvent extends infer E ?
    E extends LogEvent ?
      Omit<E, "at" | "day">
    : never
  : never;

export function logEvent(S: State, e: NewEvent, { today, now }: When): void {
  S.log.unshift({ at: now, day: today, ...e });
  S.log = S.log.slice(0, KEEP_LOG);
}

function addXp(S: State, xp: number, today: string): void {
  S.xp = Math.max(0, (S.xp || 0) + xp);
  if (xp > 0) markActiveDay(S, today);
}

/**
 * Completes a quest: logs it, adds XP, marks the day active, and either rolls a repeating
 * quest forward or marks a one-off as done. Loot is rolled separately by the caller.
 */
export function completeQuest(
  S: State,
  q: Quest,
  { today, now, via }: When & { via?: string },
): { xp: number; nextDue: string | null } {
  logEvent(S, { t: "quest", id: q.id, name: q.name, g: q.g, xp: q.xp, ...(via ? { via } : {}) }, { today, now });
  addXp(S, q.xp, today);
  if (q.repeat !== "none" && q.due) {
    q.count = (q.count || 0) + 1;
    q.due = nextOccurrence(q.due, q.repeat, today);
    return { xp: q.xp, nextDue: q.due };
  }
  q.done = true;
  q.doneAt = now;
  return { xp: q.xp, nextDue: null };
}

/** Un-checks a one-off quest and takes its XP back. */
export function uncompleteQuest(S: State, q: Quest): void {
  const i = S.log.findIndex((e) => e.t === "quest" && e.id === q.id);
  if (i >= 0) S.log.splice(i, 1);
  q.done = false;
  q.doneAt = null;
  S.xp = Math.max(0, (S.xp || 0) - q.xp);
}

/** Records a mood check-in. Only the first check-in of a day earns XP. */
export function recordMood(
  S: State,
  v: number,
  note: string,
  { today, now, via }: When & { via?: string },
  extras: Extras & { media?: string } = {},
): { first: boolean; xp: number } {
  const first = !S.moods.some((m) => m.day === today);
  const xp = first ? MOOD_XP : 0;
  const extra = { ...extras, ...(via ? { via } : {}) };
  S.moods.push({ at: now, day: today, v, s: 10, note, ...extra });
  logEvent(S, { t: "mood", v, s: 10, note, xp, ...extra }, { today, now });
  addXp(S, xp, today);
  return { first, xp };
}

/** The "Frozen?" button: two minutes of the smallest step is worth a little XP. */
export function recordFreeze(S: State, when: When, step?: string): { xp: number } {
  logEvent(S, { t: "freeze", xp: FREEZE_XP, ...(step ? { step } : {}) }, when);
  addXp(S, FREEZE_XP, when.today);
  return { xp: FREEZE_XP };
}

/** Queues XP earned outside the app so the app can roll loot for it later. */
export function queueReward(S: State, name: string, xp: number, now: number, g?: string): void {
  (S.rewards ??= []).push({ name, xp, at: now, ...(g ? { g } : {}) });
}
