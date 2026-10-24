import { describe, expect, it } from "vitest";
import { SCALES, cleanExtras, describeExtras, stepLabel } from "../../src/core/checkin";
import { recordMood } from "../../src/core/rules";
import { emptyState } from "../helpers/fixtures";

describe("check-in extras", () => {
  it("names every step in words, from low to high", () => {
    expect(SCALES.anxiety.steps).toEqual(["Calm", "Mild", "Uneasy", "High", "Very high"]);
    expect(stepLabel("energy", 1)).toBe("Empty");
    expect(stepLabel("body", 5)).toBe("Strong");
    expect(stepLabel("focus", 5)).toBe("Locked in");
    expect(stepLabel("focus", 6)).toBe("");
  });

  it("keeps only valid extras from untrusted input", () => {
    expect(
      cleanExtras({
        anxiety: 4,
        energy: 0,
        body: 2.5,
        focus: "3",
        sleep: "  4 hours, woke at 3  ",
        pain: "",
        mood: 9,
      }),
    ).toEqual({ anxiety: 4, sleep: "4 hours, woke at 3" });
    expect(cleanExtras({ sleep: "x".repeat(500) }).sleep).toHaveLength(140);
    expect(cleanExtras({})).toEqual({});
  });

  it("describes extras in words, in a fixed order", () => {
    expect(describeExtras({ focus: 1, anxiety: 4, sleep: "4 hours", pain: "lower back" })).toBe(
      "Anxiety: High · Focus: Scattered · Sleep: 4 hours · Pain: lower back",
    );
    expect(describeExtras({})).toBe("");
  });

  it("are saved with the check-in and its log entry; XP is still once a day", () => {
    const S = emptyState();
    const when = { today: "2026-10-24", now: 1000 };
    expect(recordMood(S, 3, "", when, { anxiety: 4, energy: 1, sleep: "4 hours" })).toEqual({
      first: true,
      xp: 5,
    });
    expect(S.moods[0]).toMatchObject({ v: 3, anxiety: 4, energy: 1, sleep: "4 hours" });
    expect(S.log[0]).toMatchObject({ t: "mood", v: 3, anxiety: 4, energy: 1, sleep: "4 hours" });
    expect(recordMood(S, 4, "", { ...when, now: 2000 }, { focus: 2 }).xp).toBe(0);
  });
});

describe("pictures with check-ins", () => {
  it("are part of the record's files, so backup keeps them", async () => {
    const { fileIds, addMoment } = await import("../../src/core/moments");
    const S = emptyState();
    recordMood(S, 2, "", { today: "2026-10-24", now: 1 }, { media: "gif-1" });
    recordMood(S, 6, "", { today: "2026-10-24", now: 2 });
    addMoment(S, { id: "m-1", at: 3, day: "2026-10-24", kind: "photo", caption: "" });
    addMoment(S, { id: "m-2", at: 4, day: "2026-10-24", kind: "movie", caption: "", title: "Heat" });
    expect(fileIds(S)).toEqual([
      { id: "m-1", required: true },
      { id: "gif-1", required: false },
    ]);
    expect(S.log.find((e) => e.t === "mood" && e.v === 2)).toMatchObject({ media: "gif-1" });
  });
});
