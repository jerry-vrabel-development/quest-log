/**
 * Moments: a photo, the song you were listening to, the movie you watched, each with a caption.
 * Capture them when things are good; memory drops bring them back when they're not.
 *
 * The state holds each moment's details (small, and synced). A photo's image lives in the
 * device's own storage, keyed by the moment id; a moment whose image isn't on this device is
 * simply skipped by memory drops.
 */
import type { Moment, MomentKind, State } from "./types";

export const CAPTION_MAX = 200;
export const TITLE_MAX = 120;

export interface LinkInfo {
  url: string;
  /** "Spotify", "YouTube", ... or the site's host name. */
  source: string;
}

/** First match wins, so more specific hosts come first. */
const SOURCES: [RegExp, string][] = [
  [/(^|\.)music\.youtube\.com$/, "YouTube Music"],
  [/(^|\.)spotify\.com$/, "Spotify"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)bandcamp\.com$/, "Bandcamp"],
  [/(^|\.)music\.apple\.com$/, "Apple Music"],
  [/(^|\.)soundcloud\.com$/, "SoundCloud"],
  [/(^|\.)imdb\.com$/, "IMDb"],
  [/(^|\.)letterboxd\.com$/, "Letterboxd"],
  [/(^|\.)netflix\.com$/, "Netflix"],
];

/** Accepts only http(s) links and names where they're from. Null for anything else. */
export function parseLink(raw: string): LinkInfo | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const match = SOURCES.find(([re]) => re.test(host));
  return { url: u.toString(), source: match ? match[1] : host };
}

export interface MomentInput {
  kind: MomentKind;
  caption?: string;
  title?: string;
  link?: string;
  /** Quest category this moment belongs to, so the right quests bring it back. */
  area?: string;
}

const clip = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);

/**
 * Builds a moment from what the user entered, or explains what's missing.
 * Photos need nothing else (the image is stored separately); songs and movies need a title or a link.
 */
export function makeMoment(
  input: MomentInput,
  { id, today, now }: { id: string; today: string; now: number },
): { moment: Moment } | { error: string } {
  const caption = clip(input.caption, CAPTION_MAX);
  const title = clip(input.title, TITLE_MAX);
  const rawLink = clip(input.link, 2000);
  const link = rawLink ? parseLink(rawLink) : null;
  if (rawLink && !link) return { error: "That link doesn't look right. It should start with https://" };
  if (input.kind !== "photo" && !title && !link) {
    return { error: input.kind === "song" ? "Add the song's name or a link." : "Add the title or a link." };
  }
  const area = clip(input.area, 40);
  const moment: Moment = { id, at: now, day: today, kind: input.kind, caption };
  if (title) moment.title = title;
  if (link) {
    moment.url = link.url;
    moment.source = link.source;
  }
  if (area) moment.area = area;
  return { moment };
}

export function addMoment(S: State, m: Moment): void {
  (S.moments ??= []).unshift(m);
}

export function deleteMoment(S: State, id: string): void {
  S.moments = (S.moments ?? []).filter((m) => m.id !== id);
}

/** The words a memory drop shows for a moment. */
export function describeMoment(m: Moment): { headline: string; detail: string } {
  const what =
    m.kind === "photo" ? "A photo from your day"
    : m.kind === "song" ? `You were listening to ${m.title ?? "this"}`
    : `You watched ${m.title ?? "this"}`;
  return { headline: what, detail: m.caption };
}
