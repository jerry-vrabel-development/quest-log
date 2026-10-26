import { describe, expect, it } from "vitest";
import { DEMO_DAYS, DEMO_PHOTOS, demoState } from "../../src/core/demo";
import { candidates } from "../../src/core/memories";
import { runs } from "../../src/core/streaks";
import { streak } from "../../src/core/rules";

const TODAY = "2026-10-26";

describe("the demo's sample life", () => {
  it("is the same every time", () => {
    expect(JSON.stringify(demoState(TODAY))).toBe(JSON.stringify(demoState(TODAY)));
  });

  it("adds up: XP is exactly what the record earned", () => {
    const S = demoState(TODAY);
    expect(S.xp).toBe(S.log.reduce((n, e) => n + (e.xp ?? 0), 0));
    expect(S.xp).toBeGreaterThan(0);
  });

  it("tells the story: a break, a comeback, and a run still going into today", () => {
    const S = demoState(TODAY);
    const r = runs(S.days);
    expect(r.length).toBe(2); // before the break, and since the comeback
    expect(streak(S.days, TODAY)).toBeGreaterThanOrEqual(14);
    expect(S.badges).toHaveProperty("comeback");
    expect(S.badges).toHaveProperty("low-day-hero");
  });

  it("happens entirely in the past, and leaves today's quests open to check off", () => {
    const S = demoState(TODAY);
    expect(S.log.every((e) => e.day < TODAY)).toBe(true);
    expect(S.days.every((d) => d < TODAY)).toBe(true);
    expect(S.log.at(-1)?.day).toBe(addDaysBack(DEMO_DAYS));
    expect(S.quests.filter((q) => !q.done && q.due === TODAY).length).toBeGreaterThanOrEqual(5);
  });

  it("has every kind of memory ready to come back", () => {
    const kinds = new Set(candidates(demoState(TODAY), TODAY).map((m) => m.kind));
    for (const k of ["moment", "note", "comeback", "hard-day", "best-day", "area", "badge", "mood"])
      expect(kinds).toContain(k);
  });

  it("has a picture for each photo moment, and nothing from a real person", () => {
    const S = demoState(TODAY);
    const photos = (S.moments ?? []).filter((m) => m.kind === "photo").map((m) => m.id);
    expect(photos.sort()).toEqual(DEMO_PHOTOS.map((p) => p.id).sort());
    expect(JSON.stringify(S)).not.toMatch(/Jerry|Solace|Salve|Pollyanna|Conrad/);
  });
});

function addDaysBack(n: number): string {
  const d = new Date(2026, 9, 26 - n);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
