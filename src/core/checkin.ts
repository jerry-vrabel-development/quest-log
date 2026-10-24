/**
 * Check-in extras: besides mood (1-10), a log can say how anxious, how much energy, how the body
 * feels and how focused, each on a five-step scale in words (never color), plus short notes on
 * sleep and pain. All optional: on a hard day, mood alone is a complete log.
 */
export const SCALE_KEYS = ["anxiety", "energy", "body", "focus"] as const;
export type ScaleKey = (typeof SCALE_KEYS)[number];

export interface Extras {
  /** 1 calm … 5 very high. */
  anxiety?: number;
  /** 1 empty … 5 full. */
  energy?: number;
  /** 1 rough … 5 strong. */
  body?: number;
  /** 1 scattered … 5 locked in. */
  focus?: number;
  sleep?: string;
  pain?: string;
}

export const SCALES: Record<ScaleKey, { name: string; steps: readonly [string, string, string, string, string] }> = {
  anxiety: { name: "Anxiety", steps: ["Calm", "Mild", "Uneasy", "High", "Very high"] },
  energy: { name: "Energy", steps: ["Empty", "Low", "Okay", "Good", "Full"] },
  body: { name: "Body", steps: ["Rough", "Not great", "Okay", "Good", "Strong"] },
  focus: { name: "Focus", steps: ["Scattered", "Foggy", "Okay", "Clear", "Locked in"] },
};

export const EXTRA_NOTE_MAX = 140;
/** A GIF is kept as it is (so it still moves), up to this size. Other pictures are resized. */
export const LOG_GIF_MAX_BYTES = 8 * 1024 * 1024;

/** The word for a step on a scale ("High"), or "" if it's not a step. */
export const stepLabel = (key: ScaleKey, v: number): string => SCALES[key].steps[v - 1] ?? "";

const isStep = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
const note = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, EXTRA_NOTE_MAX) : "");

/** Keeps only valid extras from untrusted input (the app's form, or Claude through the connector). */
export function cleanExtras(input: Record<string, unknown>): Extras {
  const out: Extras = {};
  for (const k of SCALE_KEYS) if (isStep(input[k])) out[k] = input[k];
  const sleep = note(input.sleep);
  const pain = note(input.pain);
  if (sleep) out.sleep = sleep;
  if (pain) out.pain = pain;
  return out;
}

/** "Anxiety: High · Energy: Low · Sleep: 4 hours", or "" when there are none. */
export function describeExtras(e: Extras): string {
  const parts: string[] = [];
  for (const k of SCALE_KEYS) {
    const v = e[k];
    if (v !== undefined) parts.push(`${SCALES[k].name}: ${stepLabel(k, v)}`);
  }
  if (e.sleep) parts.push(`Sleep: ${e.sleep}`);
  if (e.pain) parts.push(`Pain: ${e.pain}`);
  return parts.join(" · ");
}
