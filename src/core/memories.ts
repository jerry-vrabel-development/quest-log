/**
 * Memory drops: rewards made from the user's own record.
 *
 * A reinforcer only works if the learner wants it (Karen Pryor). Generic loot is just text; your own
 * past is personal. So some reward moments also bring back a memory, chosen to fit the moment:
 *
 *  - Low-mood day: how you got through before (notes from past you, comebacks, hard-day wins).
 *  - Finishing a quest: earlier wins in the same area ("Career: 5 done on Oct 23").
 *  - Jackpot: one of your best days.
 *  - Anniversary: anything from this date in an earlier year comes first.
 *  - Otherwise: a random highlight.
 *
 * Memories only lift: a low day appears only as something you got through, never the low itself,
 * and only mood check-ins of 6 or more come back. Nothing from today is a "memory".
 */
import { MOOD_LOW, moodLabel } from "./rules";
import type { Tier } from "./celebrate";
import { runs } from "./streaks";
import { addDays } from "./dates";
import { describeMoment } from "./moments";
import type { Moment, State } from "./types";

export type MemoryKind = "moment" | "note" | "comeback" | "hard-day" | "best-day" | "area" | "badge" | "mood";

export interface Memory {
  /** Stable id, so the same memory isn't shown again too soon. */
  id: string;
  kind: MemoryKind;
  /** The day it happened (YYYY-MM-DD). */
  day: string;
  headline: string;
  detail: string;
  /** The quest category, for "area" and "moment" memories. */
  area?: string;
  /** The photo, song or movie, for "moment" memories. */
  moment?: Moment;
}

export interface PastNote {
  at: number;
  day: string;
  text: string;
}

/** How many recent memory ids to remember, so drops stay fresh. */
export const MEMORY_SEEN_KEEP = 30;
/** A mood check-in comes back as a memory only at or above this. */
export const MOOD_MEMORY_MIN = 6;
export const NOTE_MAX = 280;

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;
const list = (names: string[], max = 3) =>
  names.slice(0, max).join(" · ") + (names.length > max ? ` · +${String(names.length - max)} more` : "");

/** Every memory the record holds from before `today`. */
export function candidates(S: State, today: string): Memory[] {
  const out: Memory[] = [];
  const quests = S.log.filter((e) => e.t === "quest" && e.day < today);
  const byDay = new Map<string, { names: string[]; xp: number }>();
  const byDayArea = new Map<string, string[]>();
  for (const e of [...quests].reverse()) {
    if (e.t !== "quest") continue;
    const d = byDay.get(e.day) ?? { names: [], xp: 0 };
    d.names.push(e.name);
    d.xp += e.xp;
    byDay.set(e.day, d);
    const key = `${e.g}\u0000${e.day}`;
    byDayArea.set(key, [...(byDayArea.get(key) ?? []), e.name]);
  }

  // Your best days: the top five by quests done (XP breaks ties).
  [...byDay.entries()]
    .sort(([, a], [, b]) => b.names.length - a.names.length || b.xp - a.xp)
    .slice(0, 5)
    .forEach(([day, d]) => {
      if (d.names.length < 2) return;
      out.push({
        id: `best:${day}`,
        kind: "best-day",
        day,
        headline: `${plural(d.names.length, "quest")} and ${String(d.xp)} XP in one day`,
        detail: `Including ${list(d.names)}`,
      });
    });

  // Wins by area: what you got done in each category on each day.
  for (const [key, names] of byDayArea) {
    const [area = "", day = ""] = key.split("\u0000");
    out.push({
      id: `area:${area}:${day}`,
      kind: "area",
      day,
      area,
      headline: `${area}: ${plural(names.length, "quest")} done`,
      detail: list(names),
    });
  }

  // Comebacks: every run after the first started with a return.
  const past = runs(S.days.filter((d) => d < today));
  past.slice(1).forEach((run, i) => {
    const prev = past[i]; // the run before this one
    let gap = 0;
    for (let d = addDays(prev.end, 1); d < run.start; d = addDays(d, 1)) gap++;
    const first = byDay.get(run.start)?.names[0];
    out.push({
      id: `comeback:${run.start}`,
      kind: "comeback",
      day: run.start,
      headline: `You came back after ${plural(gap, "day")} off`,
      detail: first ? `Your first step back: ${first}` : "And you kept going.",
    });
  });

  // Hard days you moved on anyway (the getting-through, never the low itself).
  const lowDays = new Set(S.moods.filter((m) => m.v <= MOOD_LOW && m.day < today).map((m) => m.day));
  for (const day of lowDays) {
    const d = byDay.get(day);
    if (!d) continue;
    out.push({
      id: `hard:${day}`,
      kind: "hard-day",
      day,
      headline: "A hard day, and you still moved",
      detail: `You did: ${list(d.names)}`,
    });
  }

  for (const e of S.log) {
    if (e.day >= today) continue;
    if (e.t === "badge")
      out.push({ id: `badge:${e.name}`, kind: "badge", day: e.day, headline: `You earned ${e.name}`, detail: "" });
    if (e.t === "mood" && e.v >= MOOD_MEMORY_MIN && e.note.trim()) {
      out.push({
        id: `mood:${String(e.at)}`,
        kind: "mood",
        day: e.day,
        headline: `You felt ${moodLabel(e.v).toLowerCase()} (${String(e.v)})`,
        detail: e.note.trim(),
      });
    }
  }

  for (const m of S.moments ?? []) {
    if (m.day >= today) continue;
    out.push({ id: `moment:${m.id}`, kind: "moment", day: m.day, area: m.area, moment: m, ...describeMoment(m) });
  }

  for (const n of S.notes ?? []) {
    if (n.day >= today) continue;
    out.push({ id: `note:${String(n.at)}`, kind: "note", day: n.day, headline: "A note from you", detail: n.text });
  }
  return out;
}

export interface MemoryContext {
  today: string;
  lowDay: boolean;
  tier: Tier;
  /** Category of the quest just finished, if any. */
  area?: string;
  /** Whether a memory can be shown on this device (a photo whose image isn't here can't). */
  available?: (m: Memory) => boolean;
}

const pick = <T>(xs: T[], rng: () => number): T | undefined => xs[Math.floor(rng() * xs.length)];
const sameDate = (a: string, b: string) => a.slice(5) === b.slice(5) && a.slice(0, 4) !== b.slice(0, 4);

/** Chooses the memory that best fits the moment, or null if the record has nothing new yet. */
export function chooseMemory(S: State, ctx: MemoryContext, rng: () => number = Math.random): Memory | null {
  const seen = new Set(S.memSeen ?? []);
  const ok = ctx.available ?? (() => true);
  const pool = candidates(S, ctx.today).filter((m) => !seen.has(m.id) && ok(m));
  if (!pool.length) return null;
  const of = (...kinds: MemoryKind[]) => pool.filter((m) => kinds.includes(m.kind));
  // Moments (photos, songs, movies) are the strongest reward there is: whenever one fits, it wins.
  const momentsFirst = (ms: Memory[]) =>
    ms.some((m) => m.kind === "moment") ? ms.filter((m) => m.kind === "moment") : ms;

  const anniversary = momentsFirst(pool.filter((m) => sameDate(m.day, ctx.today)));
  const lowDay = ctx.lowDay ? momentsFirst(of("moment", "note", "comeback", "hard-day")) : [];
  const area =
    ctx.area ? momentsFirst(pool.filter((m) => (m.kind === "area" || m.kind === "moment") && m.area === ctx.area)) : [];
  const jackpot = ctx.tier === "jackpot" ? momentsFirst(of("moment", "best-day", "comeback")) : [];
  // Otherwise favor the most personal kinds: moments count four times, notes and mood notes double.
  const moments = of("moment");
  const weighted = [...pool, ...moments, ...moments, ...moments, ...of("note", "mood")];

  for (const preferred of [anniversary, lowDay, area, jackpot]) {
    const m = pick(preferred, rng);
    if (m) return m;
  }
  return pick(weighted, rng) ?? null;
}

/** How likely a moment is to bring back a memory. Hard days and jackpots always do. */
export function memoryChance(tier: Tier, lowDay: boolean): number {
  if (lowDay || tier === "jackpot") return 1;
  return tier === "good" ? 0.5 : 0.25;
}

/** Records that a memory was shown, keeping the most recent MEMORY_SEEN_KEEP. */
export function markSeen(S: State, m: Memory): void {
  S.memSeen = [...(S.memSeen ?? []).filter((id) => id !== m.id), m.id].slice(-MEMORY_SEEN_KEEP);
}

/** Saves a note from past you. Returns false for an empty note. */
export function addNote(S: State, text: string, { today, now }: { today: string; now: number }): boolean {
  const clean = text.trim().slice(0, NOTE_MAX);
  if (!clean) return false;
  (S.notes ??= []).unshift({ at: now, day: today, text: clean });
  return true;
}

export function deleteNote(S: State, at: number): void {
  S.notes = (S.notes ?? []).filter((n) => n.at !== at);
}
