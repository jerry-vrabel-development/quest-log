/**
 * Moments: a photo, a short video, the song you were listening to, a recording, the movie you
 * watched, each with a caption.
 * Capture them when things are good; memory drops bring them back when they're not.
 *
 * The state holds each moment's details (small, and synced). Files (photos, videos, music,
 * recordings) live in the device's own storage, keyed by the moment id; a moment whose file isn't
 * on this device is simply skipped by memory drops.
 */
import type { Moment, MomentKind, State } from "./types";

export const CAPTION_MAX = 200;
export const TITLE_MAX = 120;
/** Biggest music file a song moment can carry (it's stored on the device). */
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
/** Longest in-app recording. */
export const RECORD_MAX_SECONDS = 120;
/**
 * A video moment is a short clip: up to a minute and 95 MB, so a phone video fits, storage doesn't fill
 * up, and the encrypted backup stays under the 100 MB Workers upload limit.
 */
export const VIDEO_MAX_SECONDS = 60;
export const VIDEO_MAX_BYTES = 95 * 1024 * 1024;
/**
 * Phones record big (4K is ~6 MB a second), so bigger clips are shrunk on the device before saving:
 * to at most 1280 px on the long side, at about the bitrate of a 720p stream. A minute comes out
 * around 20 MB. Clips already small and at most 720p are kept as they are.
 */
export const VIDEO_SHRINK_OVER_BYTES = 20 * 1024 * 1024;
export const VIDEO_LONG_SIDE = 1280;
export const VIDEO_BITRATE = 2_500_000;

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
  /** A music file is attached (songs) or a recording was made (recordings). */
  audio?: boolean;
  /** A video file is attached (videos). */
  video?: boolean;
}

const clip = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);

/**
 * Builds a moment from what the user entered, or explains what's missing.
 * Photos need nothing else (the image is stored separately); videos need their file; songs and movies
 * need a title or a link.
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
  if (input.kind === "recording" && !input.audio) return { error: "Record something first." };
  if (input.kind === "video" && !input.video) return { error: "Choose a video first." };
  if ((input.kind === "song" || input.kind === "movie") && !title && !link && !input.audio) {
    return {
      error: input.kind === "song" ? "Add the song's name, a link, or a music file." : "Add the title or a link.",
    };
  }
  const area = clip(input.area, 40);
  const moment: Moment = { id, at: now, day: today, kind: input.kind, caption };
  if (title) moment.title = title;
  if (link) {
    moment.url = link.url;
    moment.source = link.source;
  }
  if (area) moment.area = area;
  if (input.audio && (input.kind === "song" || input.kind === "recording")) moment.audio = true;
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
    : m.kind === "video" ? "A video from your day"
    : m.kind === "song" ? `You were listening to ${m.title ?? "this"}`
    : m.kind === "recording" ?
      m.title ?
        `You recorded ${m.title}`
      : "Something you recorded"
    : `You watched ${m.title ?? "this"}`;
  return { headline: what, detail: m.caption };
}

/** Kinds that are nothing without their file. */
const FILE_KINDS: MomentKind[] = ["photo", "video", "recording"];

/** Whether the moment carries a file (photo, video or audio) stored on the device that saved it. */
export const hasMedia = (m: Moment): boolean => FILE_KINDS.includes(m.kind) || m.audio === true;

/**
 * Whether a memory drop can show this moment on a device. Photos, videos and recordings need their
 * file; a song whose music file isn't here still shows its title.
 */
export const canShow = (m: Moment, hasLocal: (id: string) => boolean): boolean =>
  !FILE_KINDS.includes(m.kind) || hasLocal(m.id);

/** Why a video can't be a moment, or null if it can. (Length is read from the file by the app.) */
export function videoProblem(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Couldn't play that video. Try another one.";
  if (seconds > VIDEO_MAX_SECONDS + 0.5)
    return `That video is ${String(Math.round(seconds))} seconds. Moments hold up to a minute: trim it first, or pick a shorter one.`;
  return null;
}

/** Whether a clip should be shrunk before saving: too many bytes, or bigger than 720p. */
export const needsShrink = (bytes: number, width: number, height: number): boolean =>
  bytes > VIDEO_SHRINK_OVER_BYTES || Math.max(width, height) > VIDEO_LONG_SIDE;

/** The size a clip is shrunk to: the same shape, at most VIDEO_LONG_SIDE on the long side, even numbers. */
export function shrinkSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, VIDEO_LONG_SIDE / Math.max(width, height, 1));
  const even = (n: number) => Math.max(2, 2 * Math.round((n * scale) / 2));
  return { width: even(width), height: even(height) };
}

/** Even after shrinking, a clip has to fit the cap (and the 100 MB upload limit). */
export const videoTooBig = (bytes: number): string | null =>
  bytes > VIDEO_MAX_BYTES ? "That video is still too big after shrinking. Try a shorter clip." : null;

/** "01 - Harvest_Moon.mp3" → "Harvest Moon": a title guessed from a music file's name. */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/^\d{1,3}\s*[-._ ]\s*/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_MAX);
}
