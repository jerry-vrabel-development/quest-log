/** Creating, migrating and normalizing the saved state. */
import { addDays, localYmd } from "./dates";
import { DEFAULT_XP } from "./rules";
import { REPEATS, type LogEvent, type Quest, type Repeat, type State } from "./types";

export const STATE_VERSION = 3;

type SeedQuest = Pick<Quest, "g" | "name" | "tiny" | "xp"> & Partial<Pick<Quest, "due" | "time" | "repeat">>;

/** Starter quests for a first launch; they double as a tour of how quests work. */
export function seedQuests(today: string): SeedQuest[] {
  const Q = (g: string, name: string, tiny: string, xp: number, extra: Partial<SeedQuest> = {}): SeedQuest => ({
    g,
    name,
    tiny,
    xp,
    ...extra,
  });
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

const asRepeat = (v: unknown): Repeat => (REPEATS.includes(v as Repeat) ? (v as Repeat) : "none");

/** Fills in any missing fields on a quest from an older save, a backup or the server. */
export function normalizeQuest(q: Partial<Quest>, id: number = Number(q.id)): Quest {
  return {
    ...q,
    id,
    name: q.name ?? "",
    tiny: q.tiny || "",
    g: q.g || "",
    xp: Number(q.xp) || DEFAULT_XP,
    due: q.due || "",
    time: q.time || "",
    repeat: asRepeat(q.repeat),
    remind: q.remind ?? 0,
    done: !!q.done,
    doneAt: q.doneAt ?? null,
    count: q.count || 0,
  };
}

export function freshState(today: string): State {
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

/** What a saved state might look like before migration: any version, possibly partial. */
type SavedState = Partial<Omit<State, "quests">> & { quests?: Partial<Quest>[] };

/**
 * Brings any saved state (old versions, backups, server copies) up to the current shape.
 * Safe to run more than once. Mutates and returns its argument.
 */
export function upgradeState(input: unknown): State {
  const S = (input ?? {}) as SavedState;
  const quests = (S.quests || []).map((q) => normalizeQuest(q));
  // first run on v3: backfill the log from quests already finished
  const log: LogEvent[] =
    S.log ??
    quests
      .filter((q): q is Quest & { doneAt: number } => q.done && q.doneAt !== null)
      .map((q) => ({
        t: "quest" as const,
        id: q.id,
        name: q.name,
        g: q.g,
        xp: q.xp,
        at: q.doneAt,
        day: localYmd(q.doneAt),
      }))
      .sort((a, b) => b.at - a.at);
  const moods = S.moods || [];
  // v3 moods were 1-5; spread them onto 1-10 (1→1, 2→3, 3→5, 4→7, 5→9)
  for (const m of moods) if (!m.s) Object.assign(m, { v: m.v * 2 - 1, s: 10 });
  for (const e of log) if (e.t === "mood" && !e.s) Object.assign(e, { v: e.v * 2 - 1, s: 10 });

  const out = S as State;
  Object.assign(out, {
    v: STATE_VERSION,
    quests,
    log,
    moods,
    days: S.days || [],
    badges: S.badges || {},
    inv: S.inv || [],
    xp: S.xp || 0,
    dry: S.dry || 0,
    theme: S.theme || "",
    nextId: Math.max(S.nextId || 1, ...quests.map((q) => q.id + 1)),
  });
  return out;
}
