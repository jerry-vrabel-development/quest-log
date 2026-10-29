import { describe, expect, it } from "vitest";
import { addMoment } from "../../src/core/moments";
import { DEFAULT_INCLUDE, buildReport, moodWords, type Include } from "../../src/core/report";
import { completeQuest, recordMood } from "../../src/core/rules";
import type { State } from "../../src/core/types";
import { emptyState, quest } from "../helpers/fixtures";

const TODAY = "2026-10-26";
let clock = 1;
const on = (day: string) => ({ today: day, now: clock++ });

/** A hard but moving week: two rough days, walks and applications, short sleep, a highlight. */
function week(): State {
  const S = emptyState();
  const walk = quest(1, { name: "Walk Bash", g: "Bash", xp: 10 });
  const apply = quest(2, { name: "Apply to one job", g: "Career", xp: 20 });
  const days = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"];
  const moods = [6, 7, 6, 3, 6, 2, 3];
  days.forEach((d, i) => {
    recordMood(S, moods[i] ?? 5, i === 6 ? "slept on the beach" : "", on(d), {
      energy: 2,
      anxiety: 4,
      ...(i === 6 ? { sleep: "on the beach, about 6 hours", pain: "stiff neck" } : {}),
    });
    completeQuest(S, { ...walk }, on(d));
    if (i < 5) completeQuest(S, { ...apply }, on(d));
  });
  addMoment(S, { id: "m1", at: clock++, day: "2026-10-24", kind: "photo", caption: "Bash at the lake" });
  return S;
}
const report = (
  S: State,
  opts: Partial<{ period: "today" | "week" | "month"; tone: "short" | "more"; include: Include }> = {},
) => buildReport(S, { period: "week", tone: "more", include: DEFAULT_INCLUDE, today: TODAY, ...opts });

describe("share how I'm doing", () => {
  it("writes an honest week in words, with private things left out by default", () => {
    const { text, highlight } = report(week());
    expect(text).toBe(
      "This week it's been a hard stretch. Got 12 things done. Kept up Walk Bash (7 times) and Apply to one job (5 times). Energy's been low, sleep: on the beach, about 6 hours. Highlight: Bash at the lake.",
    );
    expect(highlight?.id).toBe("m1");
    for (const secret of ["anxiety", "neck", "slept on the beach", "/10", "3"]) expect(text).not.toContain(secret);
  });

  it("names one-off wins first, biggest first, and only counts routines (#75)", () => {
    const S = week();
    const walk = quest(1, { name: "Walk Bash", g: "Bash", xp: 10, repeat: "daily", due: TODAY });
    const apply = quest(2, { name: "Apply to one job", g: "Career", xp: 20, repeat: "weekdays", due: TODAY });
    S.quests.push(walk, apply);
    completeQuest(S, quest(10, { name: "Shipped #65: self-hosted fonts", g: "Programming", xp: 20 }), on("2026-10-25"));
    completeQuest(S, quest(11, { name: "Shipped the privacy review", g: "Programming", xp: 50 }), on("2026-10-24"));
    completeQuest(S, quest(12, { name: "Applied to Rumi", g: "Career", xp: 30 }), on("2026-10-26"));
    completeQuest(S, quest(13, { name: "Fixed the sink", g: "Home", xp: 5 }), on("2026-10-26"));
    const { text } = report(S);
    expect(text).toContain(
      "Got 16 things done, including Shipped the privacy review, Applied to Rumi and Shipped #65: self-hosted fonts.",
    );
    expect(text).toContain("Kept up Walk Bash (7 times) and Apply to one job (5 times).");
    expect(text).not.toContain("Fixed the sink"); // only the three biggest wins are named
    expect(report(S, { tone: "short" }).text).toBe("This week: It's been a hard stretch. 16 things done.");
  });

  it("a quest done once with no repeat is a win even if it's since been deleted", () => {
    const S = emptyState();
    completeQuest(S, quest(7, { name: "Called the landlord", g: "Home", xp: 15 }), on(TODAY));
    expect(report(S, { period: "today" }).text).toBe("Today: Got 1 thing done, including Called the landlord.");
  });

  it("adds private things only when you turn them on", () => {
    const { text } = report(week(), { include: { ...DEFAULT_INCLUDE, anxiety: true, pain: true, notes: true } });
    expect(text).toContain("anxiety's been high");
    expect(text).toContain("pain: stiff neck");
    expect(text).toContain('"slept on the beach"');
  });

  it("has a one-line headline version", () => {
    expect(report(week(), { tone: "short" }).text).toBe("This week: It's been a hard stretch. 12 things done.");
  });

  it("covers today or the month", () => {
    expect(report(week(), { period: "today", tone: "short" }).text).toBe("Today: It's been rough. 1 thing done.");
    expect(report(week(), { period: "month" }).text).toMatch(/^This month it's been a hard stretch\./);
  });

  it("says mood in words, noting rough days on an otherwise okay stretch", () => {
    const m = (v: number, day: string) => ({ at: 0, day, v, s: 10 });
    expect(moodWords([m(7, "a"), m(7, "b"), m(8, "c")], "week")).toBe("I've been doing pretty well");
    expect(moodWords([m(6, "a"), m(7, "b"), m(6, "c")], "week")).toBe("I've been mostly okay");
    expect(moodWords([m(7, "a"), m(3, "b"), m(7, "c"), m(4, "d"), m(7, "e")], "week")).toBe(
      "I've been mostly okay, with a couple of rough days",
    );
    expect(moodWords([m(9, "a")], "today")).toBe("I've been doing really well");
    expect(moodWords([], "week")).toBe("");
  });

  it("leaves things out entirely when you uncheck them, and says nothing when there's nothing", () => {
    const none: Include = {
      ...DEFAULT_INCLUDE,
      mood: false,
      wins: false,
      sleep: false,
      energy: false,
      highlight: false,
    };
    expect(report(week(), { include: none }).text).toBe("");
    expect(report(emptyState()).text).toBe("");
    expect(report(week(), { include: { ...DEFAULT_INCLUDE, mood: false } }).text).toMatch(
      /^This week: Got 12 things done/,
    );
  });
});
