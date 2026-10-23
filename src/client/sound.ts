/**
 * Marker click and reward sounds, synthesized with Web Audio (no audio files to load).
 * The marker plays the instant a behavior happens; the reward sound follows it, so the click
 * itself becomes rewarding over time (Karen Pryor's clicker principle).
 */
import type { Tier } from "../core/celebrate";
import { prefs } from "./store";

const SOUND_KEY = "quest-log-sound";

export const soundOn = (): boolean => prefs.get(SOUND_KEY) !== "0";
export const setSoundOn = (on: boolean): void => {
  prefs.set(SOUND_KEY, on ? "1" : "0");
};

let ctx: AudioContext | undefined;
function audio(): AudioContext | null {
  if (!soundOn()) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null; // no Web Audio (old browser, some test environments)
  }
}

/** A short, bright noise burst that sounds like a training clicker. */
export function playMarker(): void {
  const c = audio();
  if (!c) return;
  const len = Math.floor(c.sampleRate * 0.025);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  src.buffer = buf;
  src.connect(filter).connect(c.destination);
  src.start();
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = "sine",
  vol = 0.18,
): void {
  const o = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime + start;
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const SONGS: Record<Tier, (c: AudioContext) => void> = {
  small: (c) => {
    tone(c, 880, 0.12, 0.35);
    tone(c, 1318.5, 0.2, 0.45);
  },
  good: (c) => {
    [659.3, 784, 987.8].forEach((f, i) => tone(c, f, 0.12 + i * 0.09, 0.4, "triangle"));
    tone(c, 1318.5, 0.42, 0.6);
  },
  jackpot: (c) => {
    // drum-roll thumps while the chest shakes, then a fanfare as it opens
    [0, 0.12, 0.24, 0.36].forEach((t) => tone(c, 110, 0.1 + t, 0.12, "triangle", 0.25));
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(c, f, 0.7 + i * 0.11, 0.45, "square", 0.08));
    [1046.5, 1318.5, 1568].forEach((f) => tone(c, f, 1.2, 1.3, "triangle", 0.12));
    [1568, 2093, 2637, 2093, 2637, 3136].forEach((f, i) => tone(c, f, 1.55 + i * 0.07, 0.16, "sine", 0.07));
  },
};

/** The die hits the table: a short wooden clack, softer with each bounce (`strength` 0-1). */
export function playClack(strength = 1): void {
  const c = audio();
  if (!c) return;
  const len = Math.floor(c.sampleRate * 0.04);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 8);
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  filter.type = "bandpass";
  filter.frequency.value = 1400 + Math.random() * 900;
  filter.Q.value = 3;
  gain.gain.value = 0.9 * strength;
  src.buffer = buf;
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
  tone(c, 170, 0, 0.06, "triangle", 0.12 * strength); // the knock of the table
}

/** The die settles: a bright two-note "ding". */
export function playLand(): void {
  const c = audio();
  if (!c) return;
  tone(c, 1046.5, 0, 0.25, "triangle", 0.14);
  tone(c, 1568, 0.08, 0.4, "sine", 0.1);
}

/** Two minutes are up: a gentle two-note bell. */
export function playTimeUp(): void {
  const c = audio();
  if (!c) return;
  tone(c, 784, 0, 0.6, "sine", 0.14);
  tone(c, 1174.7, 0.18, 0.9, "sine", 0.12);
}

/** Opening the app: a warm rising chime. */
export function playWelcome(): void {
  const c = audio();
  if (!c) return;
  [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(c, f, i * 0.08, 0.5, "sine", 0.09));
}

/** Leaving the app: a soft falling chime ("rest well"). Best effort: some phones cut audio on exit. */
export function playFarewell(): void {
  if (!ctx || ctx.state !== "running" || !soundOn()) return;
  [784, 659.3, 523.3].forEach((f, i) => tone(ctx as AudioContext, f, i * 0.1, 0.6, "sine", 0.08));
}

/** The payoff sound for a tier. */
export function playReward(tier: Tier): void {
  const c = audio();
  if (c) SONGS[tier](c);
}

const BUZZ: Record<Tier | "marker", number | number[]> = {
  marker: 12,
  small: 30,
  good: [30, 40, 30],
  jackpot: [40, 60, 40, 60, 40, 60, 160],
};

/** A haptic buzz, where the device supports it (Android; iOS ignores this). */
export function buzz(kind: Tier | "marker"): void {
  try {
    navigator.vibrate(BUZZ[kind]);
  } catch {
    /* not supported */
  }
}
