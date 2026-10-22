/** Grouping, sorting and validating quests. Shared by the app's views and the MCP tools. */
import { isValidYmd, rollForward } from "./dates";
import { DEFAULT_XP, XP_VALUES } from "./rules";
import { REPEATS, type Quest, type Repeat } from "./types";

export const REMIND_OPTIONS = [-1, 0, 15, 60, 1440] as const;
export const LIMITS = { name: 120, tiny: 160, category: 40 } as const;
export const DEFAULT_CATEGORY = "My quests";

/** Sort by due date, then time; quests without a time sort last in their day. */
export const byDueTime = (a: Quest, b: Quest): number =>
  (a.due + (a.time || "99")).localeCompare(b.due + (b.time || "99"));

/**
 * Missed repeating quests roll forward to their next date on or after today, so a few
 * skipped days never turn into a wall of "overdue". Returns true if anything moved.
 */
export function rollMissed(quests: Quest[], today: string): boolean {
  let changed = false;
  for (const q of quests) {
    if (q.done || !q.due || q.repeat === "none" || q.due >= today) continue;
    q.due = rollForward(q.due, q.repeat, today);
    changed = true;
  }
  return changed;
}

/** The "Now" view: overdue, due today, and anytime. */
export function nowView(quests: Quest[], today: string): Record<"overdue" | "today" | "anytime", Quest[]> {
  const open = quests.filter((q) => !q.done);
  return {
    overdue: open.filter((q) => q.due && q.due < today).sort(byDueTime),
    today: open.filter((q) => q.due === today).sort(byDueTime),
    anytime: open.filter((q) => !q.due),
  };
}

export function upcoming(quests: Quest[], today: string): Quest[] {
  return quests.filter((q) => !q.done && q.due && q.due > today).sort(byDueTime);
}

/** Open quests grouped by category, each group sorted by due date (dated before undated). */
export function byCategory(quests: Quest[]): Record<string, Quest[]> {
  const groups: Record<string, Quest[]> = {};
  for (const q of quests.filter((x) => !x.done)) (groups[q.g || "Other"] ??= []).push(q);
  for (const g of Object.values(groups)) g.sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
  return groups;
}

export class ValidationError extends Error {}

/** Quest fields as the MCP tools accept them: `category` is the public name for `g`. */
export interface QuestInput {
  name?: unknown;
  tiny?: unknown;
  category?: unknown;
  xp?: unknown;
  due?: unknown;
  time?: unknown;
  repeat?: unknown;
  remind?: unknown;
}

export type QuestFields = Omit<Quest, "id" | "done" | "doneAt" | "count">;

const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** Text from untrusted input: strings and numbers pass through, anything else is treated as empty. */
const str = (v: unknown): string =>
  typeof v === "string" ? v
  : typeof v === "number" ? String(v)
  : "";

/**
 * Validates quest fields from an untrusted source (the MCP tools).
 * Without `partial`, missing fields get defaults; with it, only the given fields are returned.
 * @throws {ValidationError}
 */
export function cleanQuestFields(a: QuestInput, opts: { partial: true }): Partial<QuestFields>;
export function cleanQuestFields(a: QuestInput, opts?: { partial?: false }): QuestFields;
export function cleanQuestFields(a: QuestInput, { partial = false } = {}): Partial<QuestFields> {
  const out: Partial<QuestFields> = {};
  const name = str(a.name).trim().slice(0, LIMITS.name);
  if (a.name !== undefined || !partial) {
    if (!name) throw new ValidationError("Quest name can't be empty.");
    out.name = name;
  }
  if (a.tiny !== undefined) out.tiny = str(a.tiny).trim().slice(0, LIMITS.tiny);
  if (a.category !== undefined) out.g = str(a.category).trim().slice(0, LIMITS.category) || DEFAULT_CATEGORY;
  if (a.xp !== undefined) {
    if (!XP_VALUES.includes(a.xp as (typeof XP_VALUES)[number]))
      throw new ValidationError(`xp must be one of ${XP_VALUES.join(", ")}.`);
    out.xp = a.xp as number;
  }
  if (a.due !== undefined) {
    const due = str(a.due);
    if (due && !isValidYmd(due)) throw new ValidationError("due must be a real date, YYYY-MM-DD.");
    out.due = due;
  }
  if (a.time !== undefined) {
    const time = str(a.time);
    if (time && !validTime(time)) throw new ValidationError("time must be HH:MM (24h).");
    out.time = time;
  }
  if (a.repeat !== undefined) {
    if (!REPEATS.includes(a.repeat as Repeat))
      throw new ValidationError(`repeat must be one of ${REPEATS.join(", ")}.`);
    out.repeat = a.repeat as Repeat;
  }
  if (a.remind !== undefined) {
    const remind = Number(a.remind);
    if (!(REMIND_OPTIONS as readonly number[]).includes(remind))
      throw new ValidationError(`remind must be one of ${REMIND_OPTIONS.join(", ")}.`);
    out.remind = remind;
  }
  if (partial) return out;
  return {
    name,
    tiny: out.tiny ?? "",
    g: out.g ?? DEFAULT_CATEGORY,
    xp: out.xp ?? DEFAULT_XP,
    due: out.due ?? "",
    time: out.time ?? "",
    repeat: out.repeat ?? "none",
    remind: out.remind ?? 0,
  };
}
