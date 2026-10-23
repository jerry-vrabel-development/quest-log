/** A canvas confetti burst. Skipped when the user prefers reduced motion. */
import { el } from "./dom";

const DURATION_MS = 2600;
const GRAVITY = 0.42;
const COLORS = ["--accent", "--xp", "--rare", "--epic", "--legend"];

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Bursts `amount` pieces from a point (defaults to the middle of the screen). Pass `parent` to draw
 * inside a modal dialog, which sits in the top layer above anything appended to <body>.
 */
export function confetti(amount: number, origin?: { x: number; y: number }, parent: HTMLElement = document.body): void {
  if (prefersReducedMotion()) return;
  const canvas = el("canvas", "confetti");
  canvas.setAttribute("aria-hidden", "true");
  parent.append(canvas);
  const g = canvas.getContext("2d");
  if (!g) {
    canvas.remove();
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  g.scale(dpr, dpr);

  const css = getComputedStyle(document.documentElement);
  const colors = COLORS.map((v) => css.getPropertyValue(v).trim());
  const ox = origin?.x ?? innerWidth / 2;
  const oy = origin?.y ?? innerHeight * 0.45;
  const bits = Array.from({ length: amount }, () => ({
    x: ox,
    y: oy,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 16 - 5,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: 5 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));

  const end = performance.now() + DURATION_MS;
  const frame = (now: number) => {
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += GRAVITY;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.vr;
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.r);
      g.fillStyle = b.c;
      g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)));
      g.restore();
    }
    if (now < end) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
