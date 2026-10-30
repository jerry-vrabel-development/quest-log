/**
 * Property-based tests (#98): instead of hand-picked examples, fast-check generates thousands of
 * inputs and checks rules that must always hold. When one fails, fast-check shrinks it to the
 * smallest input that still breaks, so the failure reads like a regular example.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isValidYmd } from "../../src/core/dates";
import { mergeState, splitState } from "../../src/core/privacy";
import { parseQuickAdd } from "../../src/core/quickadd";
import { freshState, upgradeState } from "../../src/core/state";
import type { LogEvent, Moment, Mood, State } from "../../src/core/types";

const TODAY = "2026-10-29";
const RUNS = { numRuns: 500 };

// Words the quick-add parser must never treat as a date, time or repeat.
const PLAIN = [
  "call",
  "the",
  "dentist",
  "buy",
  "eggs",
  "fix",
  "sink",
  "write",
  "plan",
  "Bash",
  "walk",
  "read",
  "chapter",
  "email",
  "Rhiannon",
  "about",
  "demo",
  "paint",
  "garden",
  "notes",
];
const plainWord = fc.constantFrom(...PLAIN);
const plainNumber = fc.integer({ min: 8, max: 99 }).map(String); // bare numbers with no "at" or am/pm
const plainPhrase = fc
  .array(fc.oneof(plainWord, plainWord, plainNumber), { minLength: 1, maxLength: 8 })
  .map((w) => w.join(" "));

// Phrases that do carry a schedule, mixed into plain words.
const scheduleBit = fc.constantFrom(
  "today",
  "tonight",
  "tomorrow",
  "next week",
  "in 3 days",
  "on friday",
  "monday",
  "at 10am",
  "at 3",
  "noon",
  "at 5:45 pm",
  "20:15",
  "every day",
  "daily",
  "every weekday",
  "every tuesday",
  "weekly",
  "monthly",
);

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

describe("quick-add parser, for any input", () => {
  it("never throws, and any date or time it returns is real", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (s) => {
        const q = parseQuickAdd(s, TODAY);
        if (q.due) expect(isValidYmd(q.due)).toBe(true);
        if (q.due) expect(q.due >= TODAY).toBe(true);
        if (q.time) expect(q.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      }),
      { numRuns: 2000 },
    );
  });

  it("never invents a schedule for plain words, and keeps them all", () => {
    fc.assert(
      fc.property(plainPhrase, (s) => {
        const q = parseQuickAdd(s, TODAY);
        expect(q).toEqual({ name: s.charAt(0).toUpperCase() + s.slice(1) });
      }),
      RUNS,
    );
  });

  it("finds the schedule wherever it sits, and the name only ever loses words", () => {
    fc.assert(
      fc.property(plainPhrase, scheduleBit, plainPhrase, (a, bit, b) => {
        const input = `${a} ${bit} ${b}`;
        const q = parseQuickAdd(input, TODAY);
        expect(q.due ?? q.time ?? q.repeat).toBeDefined();
        const seen = new Set(words(input));
        for (const w of words(q.name)) expect(seen.has(w)).toBe(true); // nothing made up
        for (const w of words(a + " " + b)) expect(words(q.name)).toContain(w); // nothing plain lost
      }),
      RUNS,
    );
  });
});

// ---------- sync: split and merge ----------

const day = fc.integer({ min: 0, max: 60 }).map((n) => {
  const d = new Date(Date.UTC(2026, 8, 1 + n));
  return d.toISOString().slice(0, 10);
});
/** Private text that must never reach the server's readable half. */
const secret = fc.integer({ min: 0, max: 1e9 }).map((n) => `secret-${String(n)}`);

const mood: fc.Arbitrary<Mood> = fc.record({
  at: fc.integer({ min: 1, max: 1e12 }),
  day,
  v: fc.integer({ min: 1, max: 10 }),
  s: fc.constant(10),
  note: secret,
});
const note = fc.record({ at: fc.integer({ min: 1, max: 1e12 }), day, text: secret });
const moment: fc.Arbitrary<Moment> = fc.record({
  id: fc.uuid(),
  at: fc.integer({ min: 1, max: 1e12 }),
  day,
  kind: fc.constant("photo" as const),
  caption: secret,
});

/** A state with private things in it; ids and times kept unique like the app keeps them. */
const privateState = fc
  .record({
    moods: fc.uniqueArray(mood, { selector: (m) => m.at, maxLength: 15 }),
    notes: fc.uniqueArray(note, { selector: (n) => n.at, maxLength: 8 }),
    moments: fc.uniqueArray(moment, { selector: (m) => m.id, maxLength: 8 }),
  })
  .map(({ moods, notes, moments }): State => {
    const S = freshState(TODAY);
    S.moods = [...moods].sort((a, b) => a.at - b.at);
    const events: LogEvent[] = moods.map((m) => ({
      t: "mood",
      at: m.at,
      day: m.day,
      v: m.v,
      s: 10,
      note: m.note ?? "",
      xp: 5,
    }));
    S.log = events.sort((a, b) => b.at - a.at);
    S.notes = notes;
    S.moments = moments;
    return S;
  });

describe("sync split and merge, for any state", () => {
  it("the server's readable half never contains private text", () => {
    fc.assert(
      fc.property(privateState, (S) => {
        expect(JSON.stringify(splitState(S).shared)).not.toMatch(/secret-\d+/);
      }),
      RUNS,
    );
  });

  it("splitting then merging gives back every check-in, note and moment", () => {
    fc.assert(
      fc.property(privateState, (S) => {
        const { shared, secret: sealed } = splitState(S);
        const back = mergeState(shared, sealed);
        expect(back.moods.map((m) => m.at)).toEqual(S.moods.map((m) => m.at));
        expect(new Set(back.notes?.map((n) => n.text))).toEqual(new Set(S.notes?.map((n) => n.text)));
        expect(new Set(back.moments?.map((m) => m.id))).toEqual(new Set(S.moments?.map((m) => m.id)));
        expect(back.log.filter((e) => e.t === "mood").map((e) => e.at)).toEqual(
          S.log.filter((e) => e.t === "mood").map((e) => e.at),
        );
      }),
      RUNS,
    );
  });

  it("a check-in logged on the server (by Claude) is never lost in the merge", () => {
    fc.assert(
      fc.property(privateState, mood, (S, viaClaude) => {
        fc.pre(!S.moods.some((m) => m.at === viaClaude.at));
        const { shared, secret: sealed } = splitState(S);
        shared.moods.push(viaClaude); // arrived through the connector since the last sync
        const back = mergeState(shared, sealed);
        expect(back.moods.map((m) => m.at)).toContain(viaClaude.at);
        expect(back.moods.length).toBe(S.moods.length + 1);
        // still in time order
        expect(back.moods.map((m) => m.at)).toEqual([...back.moods.map((m) => m.at)].sort((a, b) => a - b));
      }),
      RUNS,
    );
  });

  it("merging is stable: doing it twice changes nothing", () => {
    fc.assert(
      fc.property(privateState, (S) => {
        const once = mergeState(splitState(S).shared, splitState(S).secret);
        const twice = mergeState(splitState(once).shared, splitState(once).secret);
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      }),
      RUNS,
    );
  });
});

// ---------- upgrading saved state ----------

describe("upgrading any saved state", () => {
  it("never throws on odd or partial input, and upgrading twice is the same as once", () => {
    const partial = fc.record(
      {
        v: fc.integer({ min: 0, max: 9 }),
        xp: fc.integer({ min: 0, max: 100000 }),
        quests: fc.array(
          fc.record(
            { id: fc.integer({ min: 1, max: 999 }), name: fc.string(), xp: fc.integer({ min: 0, max: 50 }) },
            { requiredKeys: [] },
          ),
          { maxLength: 5 },
        ),
        days: fc.array(day, { maxLength: 5 }),
        moods: fc.array(fc.record({ at: fc.integer({ min: 1, max: 1e12 }), day, v: fc.integer({ min: 1, max: 5 }) }), {
          maxLength: 5,
        }),
        theme: fc.constantFrom("", "light", "dark"),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.oneof(partial, fc.constant(null), fc.constant({})), (input) => {
        const once = upgradeState(structuredClone(input));
        const twice = upgradeState(structuredClone(once));
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
        expect(Array.isArray(once.quests) && Array.isArray(once.log)).toBe(true);
      }),
      RUNS,
    );
  });
});
