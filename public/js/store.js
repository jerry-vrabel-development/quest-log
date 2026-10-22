// @ts-check
/** The app's single state object, persisted to localStorage. */
import { localYmd } from "./core/dates.js";
import { freshState, upgradeState } from "./core/state.js";

/** @typedef {import("./core/types.js").State} State */

const KEY = "quest-log-v2";

/** The live state. Other modules read it through this live binding; replace it only via setState(). */
export let S = /** @type {State} */ (/** @type {unknown} */ (null));

/** Today in the device's local calendar. */
export const today = () => localYmd();
/** The `when` argument the core rules expect. */
export const when = () => ({ today: today(), now: Date.now() });

/** @param {unknown} next */
export function setState(next) {
  S = upgradeState(next);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    setState(raw ? JSON.parse(raw) : freshState(today()));
  } catch {
    setState(freshState(today()));
  }
}

export function reset() {
  setState(freshState(today()));
}

/** Writes to this device only, without marking the state as changed (no sync). */
export function saveLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* storage full or blocked: the app keeps working in memory */
  }
}

let afterSave = () => {};
/** Registers what happens after every save (sync uses this). @param {() => void} fn */
export function onSave(fn) {
  afterSave = fn;
}

/** Marks the state as changed, saves it, and lets sync know. */
export function save() {
  S.updatedAt = Date.now();
  saveLocal();
  afterSave();
}

/** localStorage that never throws (private mode, blocked storage). */
export const prefs = {
  /** @param {string} k */
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  /** @param {string} k @param {string} v */
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};
