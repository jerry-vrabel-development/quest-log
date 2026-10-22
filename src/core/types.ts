// Shared data shapes for the app, the MCP server and the reminder cron.

export const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type Repeat = (typeof REPEATS)[number];

export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export interface Quest {
  id: number;
  name: string;
  /** Smallest possible first step, for when the user is frozen. */
  tiny: string;
  /** Category. */
  g: string;
  xp: number;
  /** "YYYY-MM-DD", or "" for anytime. */
  due: string;
  /** "HH:MM", or "". */
  time: string;
  repeat: Repeat;
  /** Minutes before due; -1 = off. */
  remind: number;
  done: boolean;
  doneAt: number | null;
  /** How many times a repeating quest was completed. */
  count: number;
}

export interface LootItem {
  rar: Rarity;
  /** Name. */
  n: string;
  /** Description. */
  d: string;
  at: number;
}

export interface Mood {
  at: number;
  day: string;
  /** 1-10. */
  v: number;
  /** Scale; always 10 since the v3 migration. */
  s: number;
  note?: string;
  via?: string;
}

export type LogEvent =
  | { t: "quest"; at: number; day: string; id: number; name: string; g: string; xp: number; via?: string }
  | { t: "mood"; at: number; day: string; v: number; s: number; note: string; xp: number; via?: string }
  | { t: "freeze"; at: number; day: string; xp: number; step?: string }
  | { t: "badge"; at: number; day: string; name: string; xp?: undefined };

/** XP earned outside the app (via Claude); the app rolls loot for it on next open. */
export interface PendingReward {
  name: string;
  xp: number;
  at: number;
}

export interface State {
  v: number;
  quests: Quest[];
  xp: number;
  inv: LootItem[];
  /** Completions since the last drop (pity timer). */
  dry: number;
  nextId: number;
  /** Days with any XP, for streaks. */
  days: string[];
  theme: "" | "light" | "dark";
  /** Newest first. */
  log: LogEvent[];
  moods: Mood[];
  /** Badge id → earned at. */
  badges: Record<string, number>;
  rewards?: PendingReward[];
  updatedAt?: number;
}

/** "Today" and "now" for a rule that records something. */
export interface When {
  today: string;
  now: number;
}
