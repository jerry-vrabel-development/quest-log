/**
 * What sync shares with the server, and what stays sealed.
 *
 * Private (encrypted on the device with the sync-code key, src/core/vault.ts): check-ins (mood,
 * extras, notes, pictures), notes from past you, moments (captions, titles, links), which
 * memories were shown, and the profile (name, chosen areas). The server stores these as one opaque `vault` string it can't read.
 *
 * Shared (readable by the server): quests, XP, loot, badges, streak days. Push reminders and the
 * Claude connector need them. A check-in Claude logs is readable on the server only until the
 * device next syncs; the device then folds it into the sealed part.
 */
import type { LogEvent, Moment, Mood, Profile, State } from "./types";

type MoodEvent = Extract<LogEvent, { t: "mood" }>;
type Note = NonNullable<State["notes"]>[number];

export const PRIVATE_VERSION = 1;

/** The sealed part of a synced state. */
export interface PrivateBundle {
  v: typeof PRIVATE_VERSION;
  moods: Mood[];
  moodEvents: MoodEvent[];
  notes: Note[];
  moments: Moment[];
  memSeen: string[];
  profile?: Profile;
}

/** A state as the server holds it: the shared part, plus the sealed private part. */
export type SharedState = State & { vault?: string };

const isMood = (e: LogEvent): e is MoodEvent => e.t === "mood";

/** Splits a state into what the server may read and what gets sealed. */
export function splitState(S: State): { shared: SharedState; secret: PrivateBundle } {
  const secret: PrivateBundle = {
    v: PRIVATE_VERSION,
    moods: S.moods,
    moodEvents: S.log.filter(isMood),
    notes: S.notes ?? [],
    moments: S.moments ?? [],
    memSeen: S.memSeen ?? [],
    ...(S.profile ? { profile: S.profile } : {}),
  };
  const shared: SharedState = {
    ...S,
    moods: [],
    log: S.log.filter((e) => !isMood(e)),
    notes: [],
    moments: [],
    memSeen: [],
  };
  delete shared.vault;
  delete shared.profile;
  return { shared, secret };
}

/** Joins two lists, keeping one entry per key (the first seen wins). */
function union<T>(a: T[], b: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of [...a, ...b]) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/**
 * Puts a synced state back together. `secret` is null when there's nothing sealed yet (an older
 * save, or a first sync). Check-ins logged on the server (by Claude) since the last sync are kept.
 */
export function mergeState(shared: SharedState, secret: PrivateBundle | null): State {
  const S: SharedState = { ...shared };
  delete S.vault;
  if (!secret) return S;
  const moods = union(secret.moods, S.moods, (m) => String(m.at)).sort((a, b) => a.at - b.at);
  const log = union(S.log, secret.moodEvents, (e) => `${e.t}:${String(e.at)}`).sort((a, b) => b.at - a.at);
  return {
    ...S,
    moods,
    log,
    notes: union(secret.notes, S.notes ?? [], (n) => String(n.at)),
    moments: union(secret.moments, S.moments ?? [], (m) => m.id),
    memSeen: secret.memSeen.length ? secret.memSeen : (S.memSeen ?? []),
    ...((secret.profile ?? S.profile) ? { profile: secret.profile ?? S.profile } : {}),
  };
}

/** Checks a decrypted bundle has the right shape before trusting it. */
export function isPrivateBundle(x: unknown): x is PrivateBundle {
  const b = x as Partial<PrivateBundle> | null;
  return (
    !!b &&
    b.v === PRIVATE_VERSION &&
    Array.isArray(b.moods) &&
    Array.isArray(b.moodEvents) &&
    Array.isArray(b.notes) &&
    Array.isArray(b.moments) &&
    Array.isArray(b.memSeen)
  );
}
