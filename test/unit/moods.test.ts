import { describe, expect, it } from "vitest";
import { deleteMood, editMood, isMoodValue, NOTE_MAX } from "../../src/core/moods";
import { MOOD_XP, recordMood } from "../../src/core/rules";
import { emptyState } from "../helpers/fixtures";

const D1 = "2026-10-22";
const D2 = "2026-10-23";

/** A state with check-ins at the given (day, time, value) points, recorded through the real rule. */
function withMoods(...points: [string, number, number][]) {
  const S = emptyState();
  for (const [day, at, v] of points) recordMood(S, v, `note ${at}`, { today: day, now: at });
  return S;
}
const moodEvents = (S: ReturnType<typeof emptyState>) => S.log.filter((e) => e.t === "mood");

describe("isMoodValue", () => {
  it("accepts whole numbers from 1 to 10 only", () => {
    expect([1, 5, 10].every(isMoodValue)).toBe(true);
    expect([0, 11, 4.5, NaN, "5", null].some(isMoodValue)).toBe(false);
  });
});

describe("editMood", () => {
  it("changes the value and note in both the mood record and the activity log", () => {
    const S = withMoods([D1, 100, 3]);
    expect(editMood(S, 100, { v: 6, note: "  better after a walk  " })).toBe(true);
    expect(S.moods[0]).toMatchObject({ v: 6, note: "better after a walk" });
    expect(moodEvents(S)[0]).toMatchObject({ v: 6, note: "better after a walk" });
  });

  it("leaves XP and the other check-ins alone", () => {
    const S = withMoods([D1, 100, 3], [D1, 200, 4]);
    editMood(S, 200, { v: 8, note: "" });
    expect(S.xp).toBe(MOOD_XP);
    expect(S.moods.map((m) => m.v)).toEqual([3, 8]);
  });

  it("works when the log no longer has the event (old check-ins fall off the log)", () => {
    const S = withMoods([D1, 100, 3]);
    S.log = [];
    expect(editMood(S, 100, { v: 7, note: "x" })).toBe(true);
    expect(S.moods[0]?.v).toBe(7);
  });

  it("caps the note length", () => {
    const S = withMoods([D1, 100, 3]);
    editMood(S, 100, { v: 3, note: "a".repeat(NOTE_MAX + 50) });
    expect(S.moods[0]?.note).toHaveLength(NOTE_MAX);
  });

  it("returns false for an unknown check-in and rejects values outside 1-10", () => {
    const S = withMoods([D1, 100, 3]);
    expect(editMood(S, 999, { v: 5, note: "" })).toBe(false);
    expect(() => editMood(S, 100, { v: 0, note: "" })).toThrow(RangeError);
    expect(S.moods[0]?.v).toBe(3);
  });
});

describe("deleteMood", () => {
  it("removes the day's only check-in and takes its XP back", () => {
    const S = withMoods([D1, 100, 3]);
    expect(deleteMood(S, 100)).toEqual({ xpChange: -MOOD_XP });
    expect(S.moods).toEqual([]);
    expect(moodEvents(S)).toEqual([]);
    expect(S.xp).toBe(0);
  });

  it("moves the reward to the next check-in when the paid one is deleted", () => {
    const S = withMoods([D1, 100, 3], [D1, 200, 5], [D1, 300, 6]);
    expect(deleteMood(S, 100)).toEqual({ xpChange: 0 });
    expect(S.xp).toBe(MOOD_XP);
    expect(moodEvents(S).map((e) => [e.at, e.xp])).toEqual([
      [300, 0],
      [200, MOOD_XP],
    ]);
  });

  it("deleting a later, unpaid check-in changes no XP", () => {
    const S = withMoods([D1, 100, 3], [D1, 200, 5]);
    expect(deleteMood(S, 200)).toEqual({ xpChange: 0 });
    expect(S.xp).toBe(MOOD_XP);
    expect(S.moods.map((m) => m.at)).toEqual([100]);
  });

  it("only looks at the same day", () => {
    const S = withMoods([D1, 100, 3], [D2, 200, 5]);
    expect(deleteMood(S, 200)).toEqual({ xpChange: -MOOD_XP });
    expect(S.xp).toBe(MOOD_XP);
    expect(S.moods.map((m) => m.day)).toEqual([D1]);
  });

  it("still takes the reward back when the log event is gone", () => {
    const S = withMoods([D1, 100, 3]);
    S.log = [];
    expect(deleteMood(S, 100)).toEqual({ xpChange: -MOOD_XP });
    expect(S.xp).toBe(0);
  });

  it("never takes XP below zero", () => {
    const S = withMoods([D1, 100, 3]);
    S.xp = 2;
    deleteMood(S, 100);
    expect(S.xp).toBe(0);
  });

  it("returns null for an unknown check-in", () => {
    const S = withMoods([D1, 100, 3]);
    expect(deleteMood(S, 999)).toBeNull();
    expect(S.moods).toHaveLength(1);
  });
});
