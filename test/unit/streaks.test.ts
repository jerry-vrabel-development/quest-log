import { describe, expect, it } from "vitest";
import { celebrationFor, guaranteedDrop, type Moment } from "../../src/core/celebrate";
import { checkBadges, computeStats } from "../../src/core/stats";
import { comebackFor, countComebacks, honorEndedRun, runs } from "../../src/core/streaks";
import { emptyState } from "../helpers/fixtures";

const T = "2026-10-23";
/** n consecutive days ending on `end` (YYYY-MM-DD in October 2026). */
const span = (endDay: number, n: number) =>
  Array.from({ length: n }, (_, i) => `2026-10-${String(endDay - n + 1 + i).padStart(2, "0")}`);

describe("runs", () => {
  it("splits active days into consecutive runs, ignoring order and duplicates", () => {
    expect(runs(["2026-10-05", "2026-10-01", "2026-10-02", "2026-10-02", "2026-10-06"])).toEqual([
      { start: "2026-10-01", end: "2026-10-02", length: 2 },
      { start: "2026-10-05", end: "2026-10-06", length: 2 },
    ]);
    expect(runs([])).toEqual([]);
  });

  it("follows runs across month ends", () => {
    expect(runs(["2026-09-30", "2026-10-01"])).toEqual([{ start: "2026-09-30", end: "2026-10-01", length: 2 }]);
  });
});

describe("comebackFor", () => {
  it("is a comeback when there was activity before, but not yesterday or today", () => {
    expect(comebackFor(span(19, 5), T)).toEqual({ gapDays: 3, endedRun: 5, rank: 1 });
  });

  it("ranks the ended run against every earlier run (ties share a rank)", () => {
    const days = [...span(5, 8), ...span(12, 3), ...span(19, 5)];
    expect(comebackFor(days, T)?.rank).toBe(2);
    expect(comebackFor([...span(5, 5), ...span(19, 5)], T)?.rank).toBe(1);
  });

  it("is not a comeback while a streak is alive, on a second action today, or on the very first day", () => {
    expect(comebackFor(span(22, 4), T)).toBeNull(); // yesterday counted
    expect(comebackFor([...span(19, 5), T], T)).toBeNull(); // already active today
    expect(comebackFor([], T)).toBeNull(); // nothing to come back from
  });
});

describe("countComebacks", () => {
  it("counts every return after a break", () => {
    expect(countComebacks([...span(5, 2), ...span(10, 1), ...span(20, 3)])).toBe(2);
    expect(countComebacks(span(20, 9))).toBe(0);
    expect(countComebacks([])).toBe(0);
  });
});

describe("honorEndedRun", () => {
  it("names the run and how it ranks", () => {
    expect(honorEndedRun({ gapDays: 2, endedRun: 12, rank: 2 })).toBe(
      "Your 12-day streak is in the record, your second-longest.",
    );
    expect(honorEndedRun({ gapDays: 2, endedRun: 9, rank: 1 })).toContain("your longest");
    expect(honorEndedRun({ gapDays: 2, endedRun: 4, rank: 5 })).toBe("Your 4-day streak is in the record.");
  });

  it("says nothing about a single day", () => {
    expect(honorEndedRun({ gapDays: 2, endedRun: 1, rank: 1 })).toBeNull();
  });
});

describe("comeback rewards", () => {
  const moment = (over: Partial<Moment> = {}): Moment => ({
    kind: "quest",
    xp: 10,
    questXp: 10,
    item: null,
    badges: [],
    levelBefore: 3,
    levelAfter: 3,
    streakBefore: 0,
    streakAfter: 1,
    questsToday: 1,
    lowDay: false,
    ...over,
  });

  it("is a jackpot that leads with the comeback and honors the ended run", () => {
    const c = celebrationFor(moment({ comeback: { gapDays: 3, endedRun: 12, rank: 2 } }));
    expect(c.tier).toBe("jackpot");
    expect(c.reasons.slice(0, 2)).toEqual([
      "Comeback! Welcome back.",
      "Your 12-day streak is in the record, your second-longest.",
    ]);
  });

  it("counts for a mood check-in too, not just quests", () => {
    expect(
      celebrationFor(moment({ kind: "mood", xp: 5, comeback: { gapDays: 1, endedRun: 1, rank: 1 } })).reasons,
    ).toEqual(["Comeback! Welcome back."]);
  });

  it("always drops loot", () => {
    expect(guaranteedDrop({ repeatCount: 40, lowDay: false, comeback: true })).toBe(true);
    expect(guaranteedDrop({ repeatCount: 40, lowDay: false })).toBe(false);
  });

  it("earns the Comeback badge", () => {
    const S = emptyState({ days: [...span(19, 5), T] });
    expect(computeStats(S, T).comebacks).toBe(1);
    expect(checkBadges(S, { today: T, now: 1 }).map((b) => b.id)).toContain("comeback");
  });
});
