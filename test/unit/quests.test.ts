import { describe, expect, it } from "vitest";
import { ValidationError, byCategory, cleanQuestFields, nowView, rollMissed, upcoming } from "../../src/core/quests";
import { quest } from "../helpers/fixtures";

const T = "2026-10-22";

describe("rollMissed", () => {
  it("moves missed repeating quests to today or their next date, and leaves the rest alone", () => {
    const qs = [
      quest(1, { due: "2026-10-18", repeat: "daily" }),
      quest(2, { due: "2026-10-16", repeat: "weekly" }),
      quest(3, { due: "2026-10-18" }), // one-off stays overdue
      quest(4, { due: "2026-10-30", repeat: "daily" }), // future
      quest(5, { due: "2026-10-01", repeat: "daily", done: true }),
    ];
    expect(rollMissed(qs, T)).toBe(true);
    expect(qs.map((q) => q.due)).toEqual(["2026-10-22", "2026-10-23", "2026-10-18", "2026-10-30", "2026-10-01"]);
    expect(rollMissed(qs, T)).toBe(false);
  });
});

describe("views", () => {
  const qs = [
    quest(1, { due: "2026-10-20" }),
    quest(2, { due: T, time: "15:00" }),
    quest(3, { due: T, time: "09:00" }),
    quest(4, { due: T }),
    quest(5),
    quest(6, { due: "2026-10-25" }),
    quest(7, { due: T, done: true }),
  ];

  it("nowView splits overdue / today (by time, untimed last) / anytime", () => {
    const v = nowView(qs, T);
    expect(v.overdue.map((q) => q.id)).toEqual([1]);
    expect(v.today.map((q) => q.id)).toEqual([3, 2, 4]);
    expect(v.anytime.map((q) => q.id)).toEqual([5]);
  });

  it("upcoming lists future open quests", () => {
    expect(upcoming(qs, T).map((q) => q.id)).toEqual([6]);
  });

  it("byCategory groups open quests, dated before undated", () => {
    const groups = byCategory([quest(1, { g: "A" }), quest(2, { g: "A", due: "2026-11-01" }), quest(3, { g: "" })]);
    expect(groups.A.map((q) => q.id)).toEqual([2, 1]);
    expect(groups.Other.map((q) => q.id)).toEqual([3]);
  });
});

describe("cleanQuestFields", () => {
  it("applies defaults for new quests", () => {
    expect(cleanQuestFields({ name: "  Walk  " })).toEqual({
      name: "Walk",
      tiny: "",
      g: "My quests",
      xp: 15,
      due: "",
      time: "",
      repeat: "none",
      remind: 0,
    });
  });

  it("returns only the given fields for partial updates and maps category → g", () => {
    expect(cleanQuestFields({ category: "Art", due: "" }, { partial: true })).toEqual({ g: "Art", due: "" });
  });

  it("truncates long text", () => {
    expect(cleanQuestFields({ name: "x".repeat(500) }).name).toHaveLength(120);
  });

  it.each([
    [{ name: "" }, /name/],
    [{}, /name/],
    [{ name: "a", xp: 7 }, /xp/],
    [{ name: "a", due: "2026-02-30" }, /due/],
    [{ name: "a", time: "25:00" }, /time/],
    [{ name: "a", repeat: "hourly" }, /repeat/],
    [{ name: "a", remind: 5 }, /remind/],
  ])("rejects %j", (input, msg) => {
    expect(() => cleanQuestFields(input)).toThrow(ValidationError);
    expect(() => cleanQuestFields(input)).toThrow(msg);
  });
});
