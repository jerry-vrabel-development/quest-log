// @ts-check
/** Creating, migrating and normalizing the saved state. */
import { addDays, localYmd } from "./dates.js";
import { DEFAULT_XP } from "./rules.js";

/** @typedef {import("./types.js").State} State */
/** @typedef {import("./types.js").Quest} Quest */

export const STATE_VERSION = 3;

/** Starter quests for a first launch; they double as a tour of how quests work. @param {string} today */
export function seedQuests(today) {
  /** @type {(g: string, name: string, tiny: string, xp: number, extra?: Partial<Quest>) => Partial<Quest>} */
  const Q = (g, name, tiny, xp, extra = {}) => ({ g, name, tiny, xp, ...extra });
  return [
    Q("Getting started", "Check off this quest", "Tap the box on the left", 5),
    Q("Getting started", "Log how you feel right now", "Tap a number on the mood card above", 5),
    Q("Getting started", "Add one small quest of your own", "Tap + Quest", 10, { due: today }),
    Q("Health", "Drink a glass of water", "Fill the glass", 5, { due: today, time: "09:00", repeat: "daily" }),
    Q("Health", "Go outside for five minutes", "Shoes on, open the door", 10, {
      due: today,
      time: "16:00",
      repeat: "daily",
    }),
    Q("Home", "Clear one surface", "Pick up three things", 15, { due: addDays(today, 1) }),
    Q("Career", "Apply to one job", "Open one listing and read it", 20, { due: addDays(today, 1), repeat: "weekdays" }),
    Q("Career", "Update one line of your resume", "Open the file", 15),
  ];
}

/** @param {Partial<Quest>} q @param {number} id @returns {Quest} */
export function normalizeQuest(q, id = Number(q.id)) {
  return {
    ...q,
    id,
    name: String(q.name || ""),
    tiny: q.tiny || "",
    g: q.g || "",
    xp: Number(q.xp) || DEFAULT_XP,
    due: q.due || "",
    time: q.time || "",
    repeat: q.repeat || "none",
    remind: q.remind ?? 0,
    done: !!q.done,
    doneAt: q.doneAt ?? null,
    count: q.count || 0,
  };
}

/** @param {string} today @returns {State} */
export function freshState(today) {
  const quests = seedQuests(today).map((q, i) => normalizeQuest(q, i + 1));
  return {
    v: STATE_VERSION,
    quests,
    xp: 0,
    inv: [],
    dry: 0,
    nextId: quests.length + 1,
    days: [],
    theme: "",
    log: [],
    moods: [],
    badges: {},
  };
}

/**
 * Brings any saved state (old versions, backups, server copies) up to the current shape.
 * Safe to run more than once. Mutates and returns S.
 * @param {any} S @returns {State}
 */
export function upgradeState(S) {
  S.quests = (S.quests || []).map((/** @type {Partial<Quest>} */ q) => normalizeQuest(q));
  if (!S.log) {
    // first run on v3: backfill the log from quests already finished
    S.log = S.quests
      .filter((/** @type {Quest} */ q) => q.done && q.doneAt)
      .map((/** @type {Quest} */ q) => ({
        t: "quest",
        id: q.id,
        name: q.name,
        g: q.g,
        xp: q.xp,
        at: q.doneAt,
        day: localYmd(/** @type {number} */ (q.doneAt)),
      }))
      .sort((/** @type {any} */ a, /** @type {any} */ b) => b.at - a.at);
  }
  S.days = S.days || [];
  S.moods = S.moods || [];
  S.badges = S.badges || {};
  S.inv = S.inv || [];
  S.xp = S.xp || 0;
  S.dry = S.dry || 0;
  S.theme = S.theme || "";
  // v3 moods were 1-5; spread them onto 1-10 (1→1, 2→3, 3→5, 4→7, 5→9)
  for (const m of S.moods) if (!m.s) Object.assign(m, { v: m.v * 2 - 1, s: 10 });
  for (const e of S.log) if (e.t === "mood" && !e.s) Object.assign(e, { v: e.v * 2 - 1, s: 10 });
  S.nextId = Math.max(S.nextId || 1, ...S.quests.map((/** @type {Quest} */ q) => q.id + 1));
  S.v = STATE_VERSION;
  return S;
}
