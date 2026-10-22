import { describe, expect, it } from "vitest";
import {
  DROP_TABLE,
  FREEZE_XP,
  MOOD_XP,
  PITY_AFTER,
  bestStreak,
  completeQuest,
  level,
  recordFreeze,
  recordMood,
  rollLoot,
  streak,
  uncompleteQuest,
} from "../../public/js/core/rules.js";
import { emptyState, quest, seeded, sequence } from "../helpers/fixtures.js";

const T = "2026-10-22";
const when = { today: T, now: 1_000 };

describe("level", () => {
  it("starts at level 1 with 50 XP to go", () => {
    expect(level(0)).toEqual({ l: 1, into: 0, need: 50 });
  });

  it("each level needs 25% more XP", () => {
    expect(level(50)).toEqual({ l: 2, into: 0, need: 63 });
    expect(level(112)).toEqual({ l: 2, into: 62, need: 63 });
    expect(level(113)).toEqual({ l: 3, into: 0, need: 79 });
  });
});

describe("streak", () => {
  it("counts consecutive days ending today", () => {
    expect(streak(["2026-10-20", "2026-10-21", "2026-10-22"], T)).toBe(3);
  });

  it("is gentle in the morning: ending yesterday still counts", () => {
    expect(streak(["2026-10-20", "2026-10-21"], T)).toBe(2);
  });

  it("breaks after a missed day", () => {
    expect(streak(["2026-10-19", "2026-10-20"], T)).toBe(0);
  });

  it("bestStreak finds the longest run ever, ignoring order and duplicates", () => {
    expect(
      bestStreak(["2026-10-05", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-02", "2026-10-05", "2026-10-06"]),
    ).toBe(3);
    expect(bestStreak([])).toBe(0);
  });
});

describe("rollLoot", () => {
  it("maps the roll onto the drop table", () => {
    expect(rollLoot(emptyState(), sequence(0.01, 0))?.rar).toBe("legendary");
    expect(rollLoot(emptyState(), sequence(0.05, 0))?.rar).toBe("epic");
    expect(rollLoot(emptyState(), sequence(0.2, 0))?.rar).toBe("rare");
    expect(rollLoot(emptyState(), sequence(0.5, 0))?.rar).toBe("common");
    expect(rollLoot(emptyState(), sequence(0.9))).toBeNull();
  });

  it(`guarantees a drop after ${PITY_AFTER} dry rolls, then resets the pity timer`, () => {
    const S = emptyState();
    const miss = sequence(0.99);
    for (let i = 0; i < PITY_AFTER; i++) expect(rollLoot(S, miss)).toBeNull();
    expect(S.dry).toBe(PITY_AFTER);
    expect(rollLoot(S, miss)?.rar).toBe("common");
    expect(S.dry).toBe(0);
    expect(S.inv).toHaveLength(1);
  });

  it("matches the advertised drop rates over many rolls", () => {
    const S = emptyState();
    const rng = seeded(42);
    const N = 50_000;
    const counts = { legendary: 0, epic: 0, rare: 0, common: 0, none: 0 };
    for (let i = 0; i < N; i++) {
      S.dry = 0; // measure the raw table, without the pity timer
      const it = rollLoot(S, rng);
      counts[it ? it.rar : "none"]++;
    }
    let prev = 0;
    for (const [p, rar] of DROP_TABLE) {
      expect(counts[rar] / N).toBeCloseTo(p - prev, 2);
      prev = p;
    }
  });

  it("puts the newest item first", () => {
    const S = emptyState();
    rollLoot(S, sequence(0.5, 0), 1);
    rollLoot(S, sequence(0.01, 0), 2);
    expect(S.inv.map((i) => i.at)).toEqual([2, 1]);
  });
});

describe("completeQuest", () => {
  it("completes a one-off quest: XP, log entry, active day", () => {
    const S = emptyState({ quests: [quest(1, { xp: 20 })] });
    const res = completeQuest(S, S.quests[0], when);
    expect(res).toEqual({ xp: 20, nextDue: null });
    expect(S.quests[0]).toMatchObject({ done: true, doneAt: 1_000 });
    expect(S.xp).toBe(20);
    expect(S.days).toEqual([T]);
    expect(S.log[0]).toMatchObject({ t: "quest", id: 1, xp: 20, day: T });
  });

  it("rolls a repeating quest forward instead of marking it done", () => {
    const S = emptyState({ quests: [quest(1, { due: "2026-10-20", repeat: "daily" })] });
    const res = completeQuest(S, S.quests[0], when);
    expect(res.nextDue).toBe("2026-10-23");
    expect(S.quests[0]).toMatchObject({ done: false, count: 1, due: "2026-10-23" });
  });

  it("records who completed it", () => {
    const S = emptyState({ quests: [quest(1)] });
    completeQuest(S, S.quests[0], { ...when, via: "claude" });
    expect(S.log[0].via).toBe("claude");
  });

  it("uncompleteQuest undoes it without going below zero XP", () => {
    const S = emptyState({ quests: [quest(1, { xp: 30 })] });
    completeQuest(S, S.quests[0], when);
    S.xp = 10; // e.g. XP spent elsewhere
    uncompleteQuest(S, S.quests[0]);
    expect(S.xp).toBe(0);
    expect(S.quests[0].done).toBe(false);
    expect(S.log.filter((e) => e.t === "quest")).toHaveLength(0);
  });
});

describe("recordMood / recordFreeze", () => {
  it("only the first mood check-in of the day earns XP", () => {
    const S = emptyState();
    expect(recordMood(S, 4, "tired", when)).toEqual({ first: true, xp: MOOD_XP });
    expect(recordMood(S, 6, "", when)).toEqual({ first: false, xp: 0 });
    expect(S.xp).toBe(MOOD_XP);
    expect(S.moods).toHaveLength(2);
    expect(S.moods[0]).toMatchObject({ v: 4, s: 10, note: "tired" });
  });

  it("the freeze button earns a little XP and counts as an active day", () => {
    const S = emptyState();
    recordFreeze(S, when);
    expect(S.xp).toBe(FREEZE_XP);
    expect(S.days).toContain(T);
    expect(S.log[0].t).toBe("freeze");
  });
});
