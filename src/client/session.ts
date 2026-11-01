/**
 * Opening and closing the app as small rituals.
 *
 * Opening: a welcome screen shows your level and streak, and "Tap to begin" plays a warm chime
 * as it clears. Browsers only allow sound after a tap, so the tap is part of the ritual. It shows
 * on a fresh open and after 30+ minutes away. With the welcome screen off, the chime plays on the
 * first tap instead. Closing: a soft farewell chime (best effort; some phones cut audio on exit).
 */
import { level, levelTitle } from "../core/rules";
import { prefersReducedMotion } from "./confetti";
import { $ } from "./dom";
import { streakLine } from "./render";
import { buzz, playFarewell, playWelcome } from "./sound";
import { S, prefs, today } from "./store";

const SPLASH_KEY = "quest-log-splash";
const AWAY_MS = 30 * 60_000;
const LEAVE_MS = 450;

export const splashOn = (): boolean => prefs.get(SPLASH_KEY) !== "0";
export const setSplashOn = (on: boolean): void => {
  prefs.set(SPLASH_KEY, on ? "1" : "0");
};

const splash = () => $("#splash");
let welcomeArmed = false;
let afterBegin: (() => void)[] = [];

/** Runs `fn` once the opening screen is out of the way (right away if it isn't showing). */
export function whenBegun(fn: () => void): void {
  if (splash().hidden) fn();
  else afterBegin.push(fn);
}

function runAfterBegin(): void {
  const fns = afterBegin;
  afterBegin = [];
  for (const fn of fns) fn();
}

function statsLine(): string {
  const line = streakLine(today());
  const l = level(S.xp).l;
  return `Level ${String(l)} · ${levelTitle(l)} · ${line === "Start a streak today" ? "Today's a good day to start" : line}`;
}

/** While the opening screen covers the page, the page behind it can't take focus or clicks. */
function setPageInert(inert: boolean): void {
  for (const child of document.body.children) {
    if (child instanceof HTMLElement && child.id !== "splash") child.inert = inert;
  }
}

function showSplash(): void {
  const el = splash();
  $("#splashStats").textContent = statsLine();
  el.classList.remove("leaving");
  el.hidden = false;
  setPageInert(true);
  el.focus();
}

function begin(): void {
  const el = splash();
  if (el.hidden || el.classList.contains("leaving")) return;
  playWelcome();
  buzz("small");
  setPageInert(false);
  if (prefersReducedMotion()) {
    el.hidden = true;
    runAfterBegin();
    return;
  }
  el.classList.add("leaving");
  setTimeout(() => {
    el.hidden = true;
    runAfterBegin();
  }, LEAVE_MS);
}

export function initSessionSounds(): void {
  const el = splash();
  if (splashOn()) showSplash();
  else {
    el.hidden = true;
    welcomeArmed = true;
  }
  el.addEventListener("click", begin);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      begin();
    }
  });
  // Without the welcome screen, greet on the first tap anywhere.
  document.addEventListener(
    "pointerdown",
    () => {
      if (!welcomeArmed) return;
      welcomeArmed = false;
      playWelcome();
    },
    { capture: true },
  );

  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      playFarewell();
      return;
    }
    if (Date.now() - hiddenAt < AWAY_MS) return;
    if (splashOn()) showSplash();
    else welcomeArmed = true;
  });
}
