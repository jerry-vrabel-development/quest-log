// @ts-check
/** Grouping, sorting and validating quests. Shared by the app's views and the MCP tools. */
import { REPEATS, isValidYmd, rollForward } from "./dates.js";
import { DEFAULT_XP, XP_VALUES } from "./rules.js";

/** @typedef {import("./types.js").Quest} Quest */

export const REMIND_OPTIONS = [-1, 0, 15, 60, 1440];
export const LIMITS = { name: 120, tiny: 160, category: 40 };
export const DEFAULT_CATEGORY = "My quests";

/** Sort by due date, then time; quests without a time sort last in their day. @param {Quest} a @param {Quest} b */
export const byDueTime = (a, b) => (a.due + (a.time || "99")).localeCompare(b.due + (b.time || "99"));

/**
 * Missed repeating quests roll forward to their next date on or after today, so a few
 * skipped days never turn into a wall of "overdue". Returns true if anything moved.
 * @param {Quest[]} quests @param {string} today
 */
export function rollMissed(quests, today) {
  let changed = false;
  for (const q of quests) {
    if (q.done || !q.due || !q.repeat || q.repeat === "none" || q.due >= today) continue;
    q.due = rollForward(q.due, q.repeat, today);
    changed = true;
  }
  return changed;
}

/** The "Now" view: overdue, due today, and anytime. @param {Quest[]} quests @param {string} today */
export function nowView(quests, today) {
  const open = quests.filter((q) => !q.done);
  return {
    overdue: open.filter((q) => q.due && q.due < today).sort(byDueTime),
    today: open.filter((q) => q.due === today).sort(byDueTime),
    anytime: open.filter((q) => !q.due),
  };
}

/** @param {Quest[]} quests @param {string} today */
export function upcoming(quests, today) {
  return quests.filter((q) => !q.done && q.due && q.due > today).sort(byDueTime);
}

/** Open quests grouped by category, each group sorted by due date. @param {Quest[]} quests */
export function byCategory(quests) {
  /** @type {Record<string, Quest[]>} */
  const groups = {};
  for (const q of quests.filter((x) => !x.done)) (groups[q.g || "Other"] ||= []).push(q);
  for (const g of Object.values(groups)) g.sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
  return groups;
}

export class ValidationError extends Error {}

const validTime = (/** @type {string} */ s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/**
 * Validates quest fields from an untrusted source (the MCP tools).
 * With partial=false, missing fields get defaults; with partial=true only given fields are returned.
 * Accepts `category` as the public name for the internal `g` field.
 * @param {Record<string, any>} a @param {{ partial?: boolean }} [opts]
 * @returns {Partial<Quest>}
 * @throws {ValidationError}
 */
export function cleanQuestFields(a, { partial = false } = {}) {
  /** @type {Partial<Quest>} */
  const out = {};
  if (a.name !== undefined) {
    const n = String(a.name).trim().slice(0, LIMITS.name);
    if (!n) throw new ValidationError("Quest name can't be empty.");
    out.name = n;
  } else if (!partial) throw new ValidationError("Quest name can't be empty.");
  if (a.tiny !== undefined) out.tiny = String(a.tiny).trim().slice(0, LIMITS.tiny);
  if (a.category !== undefined) out.g = String(a.category).trim().slice(0, LIMITS.category) || DEFAULT_CATEGORY;
  if (a.xp !== undefined) {
    if (!XP_VALUES.includes(a.xp)) throw new ValidationError(`xp must be one of ${XP_VALUES.join(", ")}.`);
    out.xp = a.xp;
  }
  if (a.due !== undefined) {
    if (a.due && !isValidYmd(a.due)) throw new ValidationError("due must be a real date, YYYY-MM-DD.");
    out.due = a.due || "";
  }
  if (a.time !== undefined) {
    if (a.time && !validTime(a.time)) throw new ValidationError("time must be HH:MM (24h).");
    out.time = a.time || "";
  }
  if (a.repeat !== undefined) {
    if (!REPEATS.includes(a.repeat)) throw new ValidationError(`repeat must be one of ${REPEATS.join(", ")}.`);
    out.repeat = a.repeat;
  }
  if (a.remind !== undefined) {
    if (!REMIND_OPTIONS.includes(Number(a.remind)))
      throw new ValidationError(`remind must be one of ${REMIND_OPTIONS.join(", ")}.`);
    out.remind = Number(a.remind);
  }
  if (!partial) {
    out.tiny ??= "";
    out.g ??= DEFAULT_CATEGORY;
    out.xp ??= DEFAULT_XP;
    out.due ??= "";
    out.time ??= "";
    out.repeat ??= "none";
    out.remind ??= 0;
  }
  return out;
}
