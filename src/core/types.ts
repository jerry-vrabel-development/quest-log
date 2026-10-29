// Shared data shapes for the app, the MCP server and the reminder cron.
import type { Extras } from "./checkin";

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

/** A check-in: mood, plus optional extras (anxiety, energy, body, focus, sleep, pain). */
export interface Mood extends Extras {
  /** A picture or GIF with the check-in, stored on the device under this id (like moment files). */
  media?: string;
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
  | ({
      t: "mood";
      at: number;
      day: string;
      v: number;
      s: number;
      note: string;
      xp: number;
      via?: string;
      media?: string;
    } & Extras)
  | { t: "freeze"; at: number; day: string; xp: number; step?: string }
  | { t: "badge"; at: number; day: string; name: string; xp?: undefined };

/** XP earned outside the app (via Claude); the app rolls loot for it on next open. */
export interface PendingReward {
  name: string;
  xp: number;
  at: number;
}

export type MomentKind = "photo" | "song" | "movie" | "recording" | "video";

/** Something to remember a day by. A photo's image or a video is stored on the device under the moment id. */
export interface Moment {
  id: string;
  at: number;
  day: string;
  kind: MomentKind;
  caption: string;
  /** Song or movie title. */
  title?: string;
  /** Link to the song or movie (http/https only). */
  url?: string;
  /** Where the link points: "Spotify", "YouTube", "IMDb", or a host name. */
  source?: string;
  /** Quest category, so finishing a quest in that area can bring it back. */
  area?: string;
  /** A song with its music file attached, stored on the device under the moment id (recordings always are). */
  audio?: boolean;
}

/** Who the app is for, from the welcome flow (#84). Personal, so it's sealed with check-ins in sync. */
export interface Profile {
  name?: string;
  /** Areas of life chosen in the welcome, e.g. "Health", or the user's own words. */
  areas: string[];
  /** What would help most: "start" (getting started when frozen), "remember", "progress". */
  helps: string[];
  /** When the welcome was finished or skipped (it never shows again on its own). */
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
  /** Notes from past you: written on good days, they come back as memories on hard ones. */
  notes?: { at: number; day: string; text: string }[];
  /** Recently shown memory ids, so memory drops stay fresh. */
  memSeen?: string[];
  /** Photos, songs and movies to remember days by; newest first. */
  moments?: Moment[];
  /** The day the app last invited "Save this moment?", so it asks at most once a day. */
  momentInvite?: { day: string; dismissed: boolean };
  profile?: Profile;
  updatedAt?: number;
}

/** "Today" and "now" for a rule that records something. */
export interface When {
  today: string;
  now: number;
}
