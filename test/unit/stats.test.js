import { describe, expect, it } from "vitest";
import { completeQuest, recordFreeze, recordMood } from "../../public/js/core/rules.js";
import { BADGES, checkBadges, computeStats, moodByDay } from "../../public/js/core/stats.js";
import { emptyState, quest } from "../helpers/fixtures.js";

const T = "2026-10-22";
const when = { today: T, now: 5_000 };

describe("moodByDay", () => {
  it("keeps the last check-in of each day", () => {
    const m = moodByDay([
      { at: 2, day: T, v: 6, s: 10 },
      { at: 1, day: T, v: 3, s: 10 },
      { at: 3, day: "2026-10-21", v: 5, s: 10 },
    ]);
    expect(m[T].v).toBe(6);
    expect(Object.keys(m)).toHaveLength(2);
  });
});

describe("computeStats", () => {
  it("counts quests by category and XP by day", () => {
    const S = emptyState({ quests: [quest(1, { g: "Career", xp: 20 }), quest(2, { g: "Bash", xp: 10 })] });
    S.quests.forEach((q) => completeQuest(S, q, when));
    recordFreeze(S, when);
    const st = computeStats(S, T);
    expect(st.quests).toBe(2);
    expect(st.byCat).toEqual({ Career: 1, Bash: 1 });
    expect(st.xpByDay[T]).toBe(35);
    expect(st.freezes).toBe(1);
  });

  it("counts a quest finished on a low-mood day as a low-day win", () => {
    const S = emptyState({ quests: [quest(1)] });
    recordMood(S, 3, "", when);
    completeQuest(S, S.quests[0], when);
    expect(computeStats(S, T).lowDayWins).toBe(1);
  });
});

describe("checkBadges", () => {
  it("awards new badges once, logs them, and keeps the earned time", () => {
    const S = emptyState({ quests: [quest(1)] });
    completeQuest(S, S.quests[0], when);
    const earned = checkBadges(S, when);
    expect(earned.map((b) => b.id)).toEqual(["first-step"]);
    expect(S.badges["first-step"]).toBe(5_000);
    expect(S.log[0]).toMatchObject({ t: "badge", name: "First Step" });
    expect(checkBadges(S, { today: T, now: 9_999 })).toEqual([]);
    expect(S.badges["first-step"]).toBe(5_000);
  });

  it("awards several at once when they're all earned", () => {
    const S = emptyState({ quests: [quest(1)] });
    recordMood(S, 2, "", when);
    recordFreeze(S, when);
    completeQuest(S, S.quests[0], when);
    expect(checkBadges(S, when).map((b) => b.id)).toEqual(["first-step", "thaw", "check-in", "low-day-hero"]);
  });

  it("every badge has a unique id", () => {
    expect(new Set(BADGES.map((b) => b[0])).size).toBe(BADGES.length);
  });
});
