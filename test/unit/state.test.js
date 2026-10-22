import { describe, expect, it } from "vitest";
import { STATE_VERSION, freshState, upgradeState } from "../../public/js/core/state.js";

describe("freshState", () => {
  it("seeds starter quests with unique ids and a matching nextId", () => {
    const S = freshState("2026-10-22");
    const ids = S.quests.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(S.nextId).toBe(Math.max(...ids) + 1);
    expect(S.quests.every((q) => q.name && q.tiny)).toBe(true);
    expect(S).toMatchObject({ v: STATE_VERSION, xp: 0, dry: 0, inv: [], log: [], moods: [], badges: {} });
  });

  it("gives repeating starter quests a due date", () => {
    const S = freshState("2026-10-22");
    for (const q of S.quests.filter((x) => x.repeat !== "none")) expect(q.due).toBeTruthy();
  });
});

describe("upgradeState", () => {
  it("fills in fields missing from old saves and backups", () => {
    const S = upgradeState({ quests: [{ id: 7, name: "Old quest", xp: 10 }] });
    expect(S.quests[0]).toMatchObject({ due: "", time: "", repeat: "none", remind: 0, done: false, tiny: "" });
    expect(S).toMatchObject({ days: [], moods: [], badges: {}, inv: [], xp: 0, dry: 0, nextId: 8 });
  });

  it("migrates 1-5 moods onto the 1-10 scale exactly once", () => {
    const old = {
      quests: [],
      log: [{ t: "mood", v: 3, at: 1, day: "2026-10-01" }],
      moods: [
        { v: 1, at: 1, day: "2026-10-01" },
        { v: 5, at: 2, day: "2026-10-02" },
      ],
    };
    const S = upgradeState(old);
    expect(S.moods.map((m) => m.v)).toEqual([1, 9]);
    expect(S.log[0]).toMatchObject({ v: 5, s: 10 });
    upgradeState(S); // idempotent
    expect(S.moods.map((m) => m.v)).toEqual([1, 9]);
  });

  it("backfills the activity log from completed quests on first upgrade", () => {
    const S = upgradeState({
      quests: [
        { id: 1, name: "A", xp: 10, done: true, doneAt: Date.UTC(2026, 9, 20, 18) },
        { id: 2, name: "B", xp: 10, done: true, doneAt: Date.UTC(2026, 9, 21, 18) },
        { id: 3, name: "C", xp: 10, done: false },
      ],
    });
    expect(S.log.map((e) => e.name)).toEqual(["B", "A"]);
  });
});
