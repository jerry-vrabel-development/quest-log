/** The app's single state object, persisted to localStorage. */
import { localYmd } from "../core/dates";
import { freshState, upgradeState } from "../core/state";
import type { State, When } from "../core/types";
import { NS } from "./demo";

const KEY = NS + "quest-log-v2";

/**
 * The live state. Other modules read it through this live binding; replace it only via setState().
 * Assigned by load() before anything renders.
 */
export let S: State;

/** Today in the device's local calendar. */
export const today = (): string => localYmd();
/** The `when` argument the core rules expect. */
export const when = (): When => ({ today: today(), now: Date.now() });

export function setState(next: unknown): void {
  S = upgradeState(next);
}

/** A fresh start: the starter quests, at level 1 with nothing logged (the demo starts here too). */
const fresh = (): State => freshState(today());

export function load(): void {
  try {
    const raw = localStorage.getItem(KEY);
    setState(raw ? JSON.parse(raw) : fresh());
  } catch {
    setState(fresh());
  }
}

export function reset(): void {
  setState(fresh());
}

/** Writes to this device only, without marking the state as changed (no sync). */
export function saveLocal(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* storage full or blocked: the app keeps working in memory */
  }
}

let afterSave: () => void = () => {};
/** Registers what happens after every save (sync uses this). */
export function onSave(fn: () => void): void {
  afterSave = fn;
}

/** Marks the state as changed, saves it, and lets sync know. */
export function save(): void {
  S.updatedAt = Date.now();
  saveLocal();
  afterSave();
}

/** localStorage that never throws (private mode, blocked storage). */
export const prefs = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(NS + k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(NS + k, v);
    } catch {
      /* ignore */
    }
  },
};
