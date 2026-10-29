/**
 * "Share how I'm doing": a short, honest update for friends and family, written from the record,
 * for pasting into a text. You choose the period, what goes in and the tone, and you see (and can
 * edit) every word before anything leaves the app. Private things (anxiety, pain, notes) are off
 * unless you turn them on. Mood is said in words, never as a number.
 */
import { SCALES } from "./checkin";
import { addDays } from "./dates";
import type { Moment, Mood, State } from "./types";

export type Period = "today" | "week" | "month";
export type Tone = "short" | "more";
export const INCLUDE_KEYS = ["mood", "wins", "sleep", "energy", "highlight", "anxiety", "pain", "notes"] as const;
export type IncludeKey = (typeof INCLUDE_KEYS)[number];
export type Include = Record<IncludeKey, boolean>;

/** On by default: what most people would share. Off: what's more private. */
export const DEFAULT_INCLUDE: Include = {
  mood: true,
  wins: true,
  sleep: true,
  energy: true,
  highlight: true,
  anxiety: false,
  pain: false,
  notes: false,
};

const SPAN: Record<Period, number> = { today: 1, week: 7, month: 30 };
const PHRASE: Record<Period, string> = { today: "Today", week: "This week", month: "This month" };

export interface Report {
  text: string;
  /** The moment chosen as the highlight, if any (its photo can be attached). */
  highlight?: Moment;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** How the mood was, in words: never a number, gentle but honest. */
export function moodWords(moods: Mood[], period: Period): string {
  if (!moods.length) return "";
  const a = avg(moods.map((m) => m.v));
  const roughDays = new Set(moods.filter((m) => m.v <= 4).map((m) => m.day)).size;
  const base =
    a < 3.5 ? "it's been rough"
    : a < 5 ? "it's been a hard stretch"
    : a < 6.5 ? "I've been mostly okay"
    : a < 8 ? "I've been doing pretty well"
    : "I've been doing really well";
  if (period === "today" || roughDays === 0 || a < 5) return base;
  return `${base}, with ${
    roughDays === 1 ? "one rough day"
    : roughDays === 2 ? "a couple of rough days"
    : "some rough days"
  }`;
}

/** A scale's average as a lower-case word ("low", "high"), or "" with no data. */
function scaleWord(moods: Mood[], key: "energy" | "anxiety"): string {
  const vs = moods.map((m) => m[key]).filter((v): v is number => v !== undefined);
  if (!vs.length) return "";
  return (SCALES[key].steps[Math.round(avg(vs)) - 1] ?? "").toLowerCase();
}

const latest = (moods: Mood[], key: "sleep" | "pain" | "note") =>
  [...moods]
    .sort((a, b) => b.at - a.at)
    .map((m) => m[key]?.trim())
    .find(Boolean) ?? "";

const times = (n: number) =>
  n === 1 ? "once"
  : n === 2 ? "twice"
  : `${String(n)} times`;

type QuestDone = Extract<State["log"][number], { t: "quest" }>;

/**
 * Wins first, routines counted. A routine is a repeating quest, or (for a quest since deleted, whose
 * schedule is unknown) one done more than once in the period. Everything else is a one-off win, and
 * wins are named biggest first, so "Walk Bash (7 times)" can never crowd out "Shipped the release".
 * Same rule as Quest Log Insights.
 */
export function splitWins(
  S: State,
  since: string,
  today: string,
): { done: QuestDone[]; wins: QuestDone[]; routines: [string, number][] } {
  const done = S.log.filter((e): e is QuestDone => e.t === "quest" && e.day >= since && e.day <= today);
  const repeating = new Set(S.quests.filter((q) => q.repeat !== "none").map((q) => q.id));
  const known = new Set(S.quests.map((q) => q.id));
  const counts = new Map<number, number>();
  for (const e of done) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  const isRoutine = (e: QuestDone) => repeating.has(e.id) || (!known.has(e.id) && (counts.get(e.id) ?? 0) > 1);
  const wins = done.filter((e) => !isRoutine(e)).sort((a, b) => b.xp - a.xp || a.at - b.at);
  const byName = new Map<string, number>();
  for (const e of done) if (isRoutine(e)) byName.set(e.name, (byName.get(e.name) ?? 0) + 1);
  const routines = [...byName.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { done, wins, routines };
}

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "")
  : xs.length === 2 ? `${xs[0] ?? ""} and ${xs[1] ?? ""}`
  : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1) ?? ""}`;

/** "16 things done, including Shipped the release and Applied to Rumi", plus "Kept up Walk Bash (7 times)". */
function winsLines(S: State, since: string, today: string): { count: string; line: string; kept: string } {
  const { done, wins, routines } = splitWins(S, since, today);
  if (!done.length) return { count: "", line: "", kept: "" };
  const count = `${String(done.length)} thing${done.length === 1 ? "" : "s"} done`;
  const named = wins.slice(0, 3).map((e) => e.name);
  const line = named.length ? `${count}, including ${list(named)}` : count;
  const kept = routines.length ? `Kept up ${list(routines.slice(0, 2).map(([n, k]) => `${n} (${times(k)})`))}` : "";
  return { count, line, kept };
}

/** Builds the update. Returns "" text when there's nothing in the period to say. */
export function buildReport(
  S: State,
  { period, tone, include, today }: { period: Period; tone: Tone; include: Include; today: string },
): Report {
  const since = addDays(today, -(SPAN[period] - 1));
  const moods = S.moods.filter((m) => m.day >= since && m.day <= today);
  const highlight =
    include.highlight ?
      (S.moments ?? []).filter((m) => m.day >= since && m.day <= today).sort((a, b) => b.at - a.at)[0]
    : undefined;

  const mood = include.mood ? moodWords(moods, period) : "";
  const w = include.wins ? winsLines(S, since, today) : { count: "", line: "", kept: "" };
  const lead = PHRASE[period];

  if (tone === "short") {
    const parts = [mood, w.count].filter(Boolean);
    const text = parts.length ? `${lead}: ${parts.join(". ")}.` : "";
    return { text: capitalizeAfterColon(text), ...(highlight ? { highlight } : {}) };
  }

  const lines: string[] = [];
  if (mood) lines.push(`${lead} ${mood}.`);
  if (w.line) lines.push(`Got ${w.line}.`);
  if (w.kept) lines.push(`${w.kept}.`);
  const body: string[] = [];
  const energy = include.energy ? scaleWord(moods, "energy") : "";
  const anxiety = include.anxiety ? scaleWord(moods, "anxiety") : "";
  const sleep = include.sleep ? latest(moods, "sleep") : "";
  const pain = include.pain ? latest(moods, "pain") : "";
  if (energy) body.push(`energy's been ${energy}`);
  if (anxiety) body.push(`anxiety's been ${anxiety}`);
  if (sleep) body.push(`sleep: ${sleep}`);
  if (pain) body.push(`pain: ${pain}`);
  if (body.length) lines.push(cap(body.join(", ")) + ".");
  if (highlight) {
    const what = highlight.caption || highlight.title || "";
    if (what) lines.push(`Highlight: ${what}${/[.!?]$/.test(what) ? "" : "."}`);
  }
  const note = include.notes ? latest(moods, "note") : "";
  if (note) lines.push(`"${note}"`);
  const text = lines.length && !mood && lines[0] ? `${lead}: ${lines.join(" ")}` : lines.join(" ");
  return { text, ...(highlight ? { highlight } : {}) };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const capitalizeAfterColon = (s: string) => s.replace(/: (\w)/, (_, c: string) => `: ${c.toUpperCase()}`);
