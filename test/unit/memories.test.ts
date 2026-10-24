import { describe, expect, it } from "vitest";
import {
  MEMORY_SEEN_KEEP,
  addNote,
  candidates,
  chooseMemory,
  deleteNote,
  markSeen,
  memoryChance,
} from "../../src/core/memories";
import { completeQuest, recordMood } from "../../src/core/rules";
import type { State } from "../../src/core/types";
import { emptyState, quest, sequence } from "../helpers/fixtures";

const TODAY = "2026-10-26";
let clock = 1_000;
const at = (day: string) => ({ today: day, now: clock++ });

/** A small history: a big Career Friday, a low Saturday with one win, a break, a comeback Monday. */
function history(): State {
  const S = emptyState();
  const q = (id: number, name: string, g: string, xp = 10) => quest(id, { name, g, xp });
  for (const [i, name] of ["Apply: Focus", "Apply: Instrumentl", "Apply: PrairieLearn"].entries()) {
    completeQuest(S, q(10 + i, name, "Career", 20), at("2026-10-23"));
  }
  completeQuest(S, q(20, "Walk Bash", "Bash"), at("2026-10-23"));
  recordMood(S, 7, "Shipped three features", at("2026-10-23"));
  recordMood(S, 3, "heavy", at("2026-10-24"));
  completeQuest(S, q(21, "Strum for ten minutes", "Art"), at("2026-10-24"));
  S.days = ["2026-10-20", "2026-10-23", "2026-10-24"];
  return S;
}

describe("candidates", () => {
  it("finds best days, wins by area, comebacks, hard days and good-mood notes from before today", () => {
    const ms = candidates(history(), TODAY);
    const best = ms.find((m) => m.kind === "best-day");
    expect(best).toMatchObject({ day: "2026-10-23", headline: "4 quests and 70 XP in one day" });
    expect(ms.find((m) => m.id === "area:Career:2026-10-23")?.headline).toBe("Career: 3 quests done");
    expect(ms.find((m) => m.kind === "comeback")).toMatchObject({
      day: "2026-10-23",
      headline: "You came back after 2 days off",
    });
    expect(ms.find((m) => m.kind === "hard-day")).toMatchObject({
      day: "2026-10-24",
      detail: "You did: Strum for ten minutes",
    });
    expect(ms.find((m) => m.kind === "mood")?.detail).toBe("Shipped three features");
  });

  it("only lifts: low moods never come back, only the getting-through", () => {
    const ms = candidates(history(), TODAY);
    expect(ms.some((m) => m.detail === "heavy")).toBe(false);
    expect(ms.filter((m) => m.kind === "mood").every((m) => !m.headline.includes("3"))).toBe(true);
  });

  it("never treats today as a memory", () => {
    expect(candidates(history(), "2026-10-23").some((m) => m.day >= "2026-10-23")).toBe(false);
  });

  it("is empty for a brand-new record", () => {
    expect(candidates(emptyState(), TODAY)).toEqual([]);
  });
});

describe("chooseMemory", () => {
  const ctx = { today: TODAY, lowDay: false, tier: "small" as const };

  it("on a low day, brings back how you got through before", () => {
    for (const r of [0, 0.5, 0.99]) {
      const m = chooseMemory(history(), { ...ctx, lowDay: true }, sequence(r));
      expect(["note", "comeback", "hard-day"]).toContain(m?.kind);
    }
  });

  it("prefers notes from past you on a low day when there are some", () => {
    const S = history();
    addNote(S, "You've come back before. You will again.", at("2026-10-23"));
    const ms = [0, 0.3, 0.6, 0.99].map((r) => chooseMemory(S, { ...ctx, lowDay: true }, sequence(r))?.kind);
    expect(ms).toContain("note");
  });

  it("after a quest, prefers earlier wins in the same area", () => {
    expect(chooseMemory(history(), { ...ctx, area: "Career" }, sequence(0))?.id).toBe("area:Career:2026-10-23");
  });

  it("at a jackpot, brings back a best day or a comeback", () => {
    expect(["best-day", "comeback"]).toContain(
      chooseMemory(history(), { ...ctx, tier: "jackpot" }, sequence(0.5))?.kind,
    );
  });

  it("puts anniversaries first", () => {
    const m = chooseMemory(history(), { ...ctx, today: "2027-10-23", lowDay: true, area: "Art" }, sequence(0));
    expect(m?.day).toBe("2026-10-23");
  });

  it("doesn't repeat a memory until others have been shown", () => {
    const S = history();
    const shown = new Set<string>();
    const total = candidates(S, TODAY).length;
    for (let i = 0; i < total; i++) {
      const m = chooseMemory(S, ctx, sequence(0));
      expect(m).not.toBeNull();
      if (!m) break;
      expect(shown.has(m.id)).toBe(false);
      shown.add(m.id);
      markSeen(S, m);
    }
    expect(chooseMemory(S, ctx)).toBeNull(); // everything shown recently
  });

  it("returns null when there is nothing to remember yet", () => {
    expect(chooseMemory(emptyState(), ctx)).toBeNull();
  });
});

describe("memoryChance", () => {
  it("always on hard days and jackpots, sometimes otherwise", () => {
    expect(memoryChance("small", true)).toBe(1);
    expect(memoryChance("jackpot", false)).toBe(1);
    expect(memoryChance("good", false)).toBe(0.5);
    expect(memoryChance("small", false)).toBe(0.25);
  });
});

describe("markSeen", () => {
  it("keeps only the most recent ids", () => {
    const S = emptyState();
    for (let i = 0; i < MEMORY_SEEN_KEEP + 5; i++)
      markSeen(S, { id: `m${String(i)}`, kind: "badge", day: "2026-10-01", headline: "", detail: "" });
    expect(S.memSeen).toHaveLength(MEMORY_SEEN_KEEP);
    expect(S.memSeen?.at(-1)).toBe(`m${String(MEMORY_SEEN_KEEP + 4)}`);
  });
});

describe("notes from past you", () => {
  it("saves trimmed notes, newest first, and ignores empty ones", () => {
    const S = emptyState();
    expect(addNote(S, "  first  ", at("2026-10-23"))).toBe(true);
    expect(addNote(S, "   ", at("2026-10-23"))).toBe(false);
    addNote(S, "second", at("2026-10-24"));
    expect(S.notes?.map((n) => n.text)).toEqual(["second", "first"]);
  });

  it("can be deleted", () => {
    const S = emptyState();
    addNote(S, "keep", at("2026-10-23"));
    addNote(S, "remove", at("2026-10-23"));
    const remove = S.notes?.find((n) => n.text === "remove");
    if (remove) deleteNote(S, remove.at);
    expect(S.notes?.map((n) => n.text)).toEqual(["keep"]);
  });
});
