import { describe, expect, it } from "vitest";
import {
  BIG_QUEST_XP,
  HABIT_WARMUP,
  celebrationFor,
  guaranteedDrop,
  isLowDay,
  type Moment,
} from "../../src/core/celebrate";
import { rollLoot } from "../../src/core/rules";
import type { LootItem } from "../../src/core/types";
import { emptyState, sequence } from "../helpers/fixtures";

const T = "2026-10-22";
const item = (rar: LootItem["rar"]): LootItem => ({ rar, n: "Thing", d: "", at: 0 });
const moment = (over: Partial<Moment> = {}): Moment => ({
  kind: "quest",
  xp: 10,
  questXp: 10,
  item: null,
  badges: [],
  levelBefore: 3,
  levelAfter: 3,
  streakBefore: 2,
  streakAfter: 2,
  questsToday: 2,
  lowDay: false,
  ...over,
});

describe("celebrationFor", () => {
  it("an ordinary quest with no drop is a small moment", () => {
    expect(celebrationFor(moment())).toEqual({ tier: "small", reasons: [] });
  });

  it("a common or rare drop, or a 20+ XP quest, is a good moment", () => {
    expect(celebrationFor(moment({ item: item("rare") })).tier).toBe("good");
    expect(celebrationFor(moment({ xp: 20, questXp: 20 })).tier).toBe("good");
  });

  it.each<[string, Partial<Moment>, string]>([
    ["a level-up", { levelAfter: 4 }, "Level 4!"],
    ["a legendary drop", { item: item("legendary") }, "Legendary drop!"],
    ["an epic drop", { item: item("epic") }, "Epic drop!"],
    ["a badge", { badges: ["First Step"] }, "Badge: First Step"],
    ["crossing a streak milestone", { streakBefore: 6, streakAfter: 7 }, "7-day streak!"],
    ["the first quest on a low day", { lowDay: true, questsToday: 1 }, "You moved on a hard day."],
    ["the 5th quest of the day", { questsToday: 5 }, "Big day: 5 quests!"],
    ["the 10th quest of the day", { questsToday: 10 }, "Big day: 10 quests!"],
    ["a big quest", { questXp: BIG_QUEST_XP, xp: BIG_QUEST_XP }, "Big quest done!"],
  ])("%s is a jackpot", (_, over, reason) => {
    const c = celebrationFor(moment(over));
    expect(c.tier).toBe("jackpot");
    expect(c.reasons).toContain(reason);
  });

  it("lists every reason, most important first", () => {
    const c = celebrationFor(moment({ levelAfter: 4, badges: ["Ten Down"], questsToday: 10 }));
    expect(c.reasons).toEqual(["Level 4!", "Badge: Ten Down", "Big day: 10 quests!"]);
  });

  it("keeps jackpots rare: later quests on a low day, a 6th quest, or staying on a milestone don't count", () => {
    expect(celebrationFor(moment({ lowDay: true, questsToday: 2 })).tier).toBe("small");
    expect(celebrationFor(moment({ questsToday: 6 })).tier).toBe("small");
    expect(celebrationFor(moment({ streakBefore: 7, streakAfter: 7 })).tier).toBe("small");
  });

  it("only quests count toward big days and hard-day wins", () => {
    expect(celebrationFor(moment({ kind: "mood", questsToday: 5 })).tier).toBe("small");
    expect(celebrationFor(moment({ kind: "freeze", lowDay: true, questsToday: 1 })).tier).toBe("small");
  });
});

describe("continuous reinforcement", () => {
  it(`a repeating quest's first ${HABIT_WARMUP} completions always drop loot`, () => {
    for (let n = 1; n <= HABIT_WARMUP; n++) expect(guaranteedDrop({ repeatCount: n, lowDay: false })).toBe(true);
    expect(guaranteedDrop({ repeatCount: HABIT_WARMUP + 1, lowDay: false })).toBe(false);
    expect(guaranteedDrop({ repeatCount: 0, lowDay: false })).toBe(false); // one-off quests stay variable
  });

  it("every quest on a low day drops loot", () => {
    expect(guaranteedDrop({ repeatCount: 40, lowDay: true })).toBe(true);
  });

  it("a guaranteed roll that misses the table still drops a common item, without touching the pity counter", () => {
    const S = emptyState({ dry: 2 });
    expect(rollLoot(S, sequence(0.99, 0), 1, true)?.rar).toBe("common");
    expect(S.dry).toBe(0);
  });

  it("a guaranteed roll can still land something rarer", () => {
    expect(rollLoot(emptyState(), sequence(0.01, 0), 1, true)?.rar).toBe("legendary");
  });
});

describe("isLowDay", () => {
  it("uses today's latest check-in", () => {
    const moods = [
      { at: 1, day: T, v: 3, s: 10 },
      { at: 2, day: T, v: 6, s: 10 },
    ];
    expect(isLowDay(moods, T)).toBe(false);
    expect(isLowDay(moods.slice(0, 1), T)).toBe(true);
    expect(isLowDay([{ at: 1, day: "2026-10-21", v: 2, s: 10 }], T)).toBe(false);
  });
});
