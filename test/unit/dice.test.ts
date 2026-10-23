import { describe, expect, it } from "vitest";
import { recordFreeze } from "../../src/core/rules";
import { diceCandidates, FALLBACK_STEPS, roll, rollFace } from "../../src/core/dice";
import { emptyState, quest, sequence } from "../helpers/fixtures";

const T = "2026-10-22";

describe("diceCandidates", () => {
  it("offers the tiny steps of open quests that are overdue, due today or anytime", () => {
    const quests = [
      quest(1, { name: "Water", tiny: "Fill the glass", due: T }),
      quest(2, { name: "Resume", tiny: "Open the file" }),
      quest(3, { name: "Overdue", tiny: "Just start", due: "2026-10-20" }),
      quest(4, { name: "Future", tiny: "Not yet", due: "2026-10-25" }),
      quest(5, { name: "Done", tiny: "Already did it", done: true }),
      quest(6, { name: "No tiny step", tiny: "  " }),
    ];
    expect(diceCandidates(quests, T)).toEqual([
      { step: "Fill the glass", questId: 1, questName: "Water" },
      { step: "Open the file", questId: 2, questName: "Resume" },
      { step: "Just start", questId: 3, questName: "Overdue" },
    ]);
  });

  it("falls back to universal micro-steps when no quest has one ready", () => {
    expect(diceCandidates([quest(1, { tiny: "" })], T).map((c) => c.step)).toEqual(FALLBACK_STEPS);
  });
});

describe("roll", () => {
  const c = [{ step: "a" }, { step: "b" }, { step: "c" }];

  it("picks by the random roll", () => {
    expect(roll(c, sequence(0)).step).toBe("a");
    expect(roll(c, sequence(0.99)).step).toBe("c");
  });

  it("never repeats the previous pick when there is a choice", () => {
    for (const r of [0, 0.4, 0.99]) expect(roll(c, sequence(r), { step: "b" }).step).not.toBe("b");
  });

  it("with one candidate, returns it even if it was the previous pick", () => {
    expect(roll([{ step: "only" }], sequence(0.5), { step: "only" }).step).toBe("only");
  });

  it("refuses an empty list", () => {
    expect(() => roll([])).toThrow();
  });
});

describe("rollFace", () => {
  it("lands on a face from 1 to 6", () => {
    expect(rollFace(sequence(0))).toBe(1);
    expect(rollFace(sequence(0.99))).toBe(6);
  });

  it("never shows the same face twice in a row", () => {
    for (const r of [0, 0.3, 0.6, 0.99]) expect(rollFace(sequence(r), 4)).not.toBe(4);
  });
});

describe("recordFreeze", () => {
  it("logs which tiny step broke the freeze", () => {
    const S = emptyState();
    recordFreeze(S, { today: T, now: 1 }, "Fill the glass");
    expect(S.log[0]).toMatchObject({ t: "freeze", step: "Fill the glass", xp: 5 });
  });
});
