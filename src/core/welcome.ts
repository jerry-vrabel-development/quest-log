/**
 * The welcome flow (#84): three skippable questions on first launch (your name, what matters,
 * what would help) that turn the generic starter quests into ones that fit. Pure: no I/O, no clock.
 */
import { addDays, parseYmd } from "./dates";
import { normalizeQuest, seedQuests } from "./state";
import type { Profile, Quest, Repeat, State } from "./types";

type Starter = Pick<Quest, "g" | "name" | "tiny" | "xp"> & {
  repeat?: Repeat;
  time?: string;
  due?: "today" | "tomorrow" | "sunday";
};

/** Areas offered in the welcome, each with an icon so the choice never rests on color. */
export const AREAS = [
  { id: "Health", icon: "💚" },
  { id: "Work", icon: "💼" },
  { id: "Home", icon: "🏠" },
  { id: "Pet", icon: "🐾" },
  { id: "Art", icon: "🎨" },
  { id: "Money", icon: "💵" },
  { id: "Friends & family", icon: "🤝" },
  { id: "Learning", icon: "📚" },
] as const;

export const HELPS = [
  { id: "start", label: "Getting started when I'm frozen" },
  { id: "remember", label: "Remembering things" },
  { id: "progress", label: "Seeing my progress" },
] as const;

const AREA_QUESTS: Partial<Record<string, Starter[]>> = {
  Health: [
    {
      g: "Health",
      name: "Drink a glass of water",
      tiny: "Fill the glass",
      xp: 5,
      repeat: "daily",
      time: "09:00",
      due: "today",
    },
    {
      g: "Health",
      name: "Go outside for five minutes",
      tiny: "Shoes on, open the door",
      xp: 10,
      repeat: "daily",
      due: "today",
    },
  ],
  Work: [
    {
      g: "Work",
      name: "Do one small work task",
      tiny: "Open the thing you've been avoiding",
      xp: 15,
      repeat: "weekdays",
      due: "today",
    },
  ],
  Home: [{ g: "Home", name: "Clear one surface", tiny: "Pick up three things", xp: 15, due: "tomorrow" }],
  Pet: [
    {
      g: "Pet",
      name: "Walk or play with your pet",
      tiny: "Grab the leash or a toy",
      xp: 10,
      repeat: "daily",
      due: "today",
    },
  ],
  Art: [
    {
      g: "Art",
      name: "Make something for 10 minutes",
      tiny: "Pick up the pen, brush or instrument",
      xp: 15,
      repeat: "daily",
      due: "today",
    },
  ],
  Money: [
    {
      g: "Money",
      name: "Look at one bill or balance",
      tiny: "Open the app and just look",
      xp: 15,
      repeat: "weekly",
      due: "tomorrow",
    },
  ],
  "Friends & family": [
    {
      g: "Friends & family",
      name: "Send one message to someone you like",
      tiny: "Open your messages",
      xp: 10,
      repeat: "weekly",
      due: "today",
    },
  ],
  Learning: [
    {
      g: "Learning",
      name: "Read or learn for 10 minutes",
      tiny: "Open it to where you left off",
      xp: 10,
      repeat: "daily",
      due: "today",
    },
  ],
};

const HELP_QUESTS: Partial<Record<string, Starter>> = {
  start: {
    g: "Getting started",
    name: "Roll the dice once when you're stuck",
    tiny: "Tap 🎲 Frozen? at the top",
    xp: 5,
    due: "today",
  },
  remember: {
    g: "Getting started",
    name: "Turn on reminders",
    tiny: "Settings → Reminders → Turn on",
    xp: 5,
    due: "today",
  },
  progress: {
    g: "Getting started",
    name: "Look at your Journey on Sunday",
    tiny: "Tap the Journey tab",
    xp: 5,
    due: "sunday",
  },
};

const MAX_AREA = 40;
const MAX_NAME = 40;

/** Tidies the answers: trims, drops blanks and duplicates, caps lengths. */
export function cleanAnswers(a: { name?: string; areas: string[]; helps: string[] }): Omit<Profile, "at"> {
  const name = (a.name ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
  const areas = [...new Set(a.areas.map((x) => x.trim().replace(/\s+/g, " ").slice(0, MAX_AREA)).filter(Boolean))];
  const helps = [...new Set(a.helps.filter((h) => HELPS.some((x) => x.id === h)))];
  return { ...(name ? { name } : {}), areas, helps };
}

/** The starter quests for these answers: one or two per area (your own areas get a simple one), plus helpers. */
export function starters(areas: string[], helps: string[]): Starter[] {
  const out: Starter[] = [];
  for (const a of areas)
    out.push(
      ...(AREA_QUESTS[a] ?? [
        { g: a, name: `One small step for ${a}`, tiny: "Write down the smallest next step", xp: 15, due: "today" },
      ]),
    );
  for (const h of helps) {
    const q = HELP_QUESTS[h];
    if (q) out.push(q);
  }
  return out;
}

const resolveDue = (d: Starter["due"], today: string): string => {
  if (d === "tomorrow") return addDays(today, 1);
  if (d === "sunday") return addDays(today, (7 - parseYmd(today).getUTCDay()) % 7 || 7);
  return today;
};

/**
 * Records the profile and, if any areas were chosen, swaps the generic starter quests (only ones
 * still untouched) for quests that fit. The "Getting started" tour stays. Mutates S.
 */
export function applyWelcome(
  S: State,
  answers: { name?: string; areas: string[]; helps: string[] },
  today: string,
  now: number,
): void {
  const a = cleanAnswers(answers);
  S.profile = { ...a, at: now };
  const fresh = starters(a.areas, a.helps);
  if (!fresh.length) return;
  if (a.areas.length) {
    const generic = new Set(
      seedQuests(today)
        .filter((q) => q.g !== "Getting started")
        .map((q) => q.name),
    );
    S.quests = S.quests.filter((q) => !(generic.has(q.name) && !q.done && q.count === 0));
  }
  const have = new Set(S.quests.map((q) => q.name));
  for (const q of fresh) {
    if (have.has(q.name)) continue;
    const { due, ...rest } = q;
    S.quests.push(normalizeQuest({ ...rest, due: resolveDue(due, today), remind: q.time ? 0 : -1 }, S.nextId++));
    have.add(q.name);
  }
}

/** Marks the welcome as skipped, so it doesn't ask again on its own. */
export function skipWelcome(S: State, now: number): void {
  S.profile ??= { areas: [], helps: [], at: now };
}

/** "Good morning, Rhiannon." by the hour of the day (0-23), or "" without a name. */
export function greeting(name: string | undefined, hour: number): string {
  if (!name) return "";
  const part =
    hour < 5 ? "Hey"
    : hour < 12 ? "Good morning"
    : hour < 17 ? "Good afternoon"
    : "Good evening";
  return `${part}, ${name}.`;
}

/** Whether to offer the welcome: a brand-new start (nothing done yet) that hasn't seen it. */
export const shouldWelcome = (S: State): boolean => !S.profile && S.log.length === 0;
