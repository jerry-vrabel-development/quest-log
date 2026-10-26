/**
 * Demo mode (`?demo`): Quest Log with a sample life already in it, for anyone who wants to see the
 * good parts in a minute. It's a sandbox: its own browser storage and media database, sync, push
 * and reminders off, so it can never touch a real account or the server. Reset puts the sample back.
 */
import { DEMO_PHOTOS, type DemoScene } from "../core/demo";

export const DEMO = new URLSearchParams(location.search).has("demo");

/** Storage keys and the media database get this prefix in the demo, so real data is never touched. */
export const NS = DEMO ? "quest-log-demo:" : "";

/** Draws a simple illustration for a sample photo moment (they're clearly drawings, not real photos). */
export function drawScene(scene: DemoScene): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 960;
  c.height = 640;
  const g = c.getContext("2d");
  if (!g) return Promise.reject(new Error("No canvas"));
  const sky = g.createLinearGradient(0, 0, 0, 420);
  if (scene === "lake") {
    sky.addColorStop(0, "#f6c38b");
    sky.addColorStop(1, "#e8875a");
    g.fillStyle = sky;
    g.fillRect(0, 0, 960, 420);
    g.fillStyle = "#ffe2a8";
    g.beginPath();
    g.arc(620, 380, 70, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3d6f86";
    g.fillRect(0, 400, 960, 240);
    g.strokeStyle = "rgba(255,226,168,.55)";
    g.lineWidth = 6;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(560 - i * 10, 440 + i * 28);
      g.lineTo(680 + i * 10, 440 + i * 28);
      g.stroke();
    }
    // a dog on the shore, in silhouette
    g.fillStyle = "#2b2b2b";
    g.beginPath();
    g.ellipse(250, 520, 70, 34, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(330, 482, 30, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(200, 540, 14, 60);
    g.fillRect(290, 540, 14, 60);
    g.beginPath();
    g.moveTo(180, 505);
    g.quadraticCurveTo(140, 470, 150, 450);
    g.lineWidth = 12;
    g.strokeStyle = "#2b2b2b";
    g.stroke();
  } else {
    sky.addColorStop(0, "#c9dbe8");
    sky.addColorStop(1, "#eef2f4");
    g.fillStyle = sky;
    g.fillRect(0, 0, 960, 640);
    g.fillStyle = "#7d9b76";
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 110;
      g.beginPath();
      g.moveTo(x, 420);
      g.lineTo(x + 50, 170 + (i % 3) * 40);
      g.lineTo(x + 100, 420);
      g.fill();
    }
    g.fillStyle = "#b9a07a";
    g.beginPath();
    g.moveTo(380, 640);
    g.quadraticCurveTo(470, 470, 480, 420);
    g.lineTo(500, 420);
    g.quadraticCurveTo(560, 520, 640, 640);
    g.fill();
  }
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw"))), "image/jpeg", 0.85);
  });
}

export const demoPhotos = DEMO_PHOTOS;

/** The banner across the top of the demo: what it is, Reset, and the way out. */
export function showDemoBanner(onReset: () => void): void {
  // A labelled landmark, so it's reachable by region navigation like the rest of the page.
  const bar = document.createElement("aside");
  bar.className = "demo-banner";
  bar.setAttribute("aria-label", "Demo");
  const text = document.createElement("span");
  text.innerHTML =
    "<b>Demo</b> · a sample life, kept in this browser only. Check things off, log a mood, see what comes back.";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn small ghost";
  reset.textContent = "Reset demo";
  reset.onclick = onReset;
  const leave = document.createElement("a");
  leave.href = location.pathname;
  leave.className = "btn small ghost";
  leave.textContent = "Leave demo";
  const btns = document.createElement("span");
  btns.className = "banner-btns";
  btns.append(reset, leave);
  bar.append(text, btns);
  document.body.prepend(bar);
}

/** Throws the demo away (its storage and its files) and starts it over with the sample life. */
export async function resetDemo(): Promise<void> {
  if (!DEMO) return;
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(NS)) localStorage.removeItem(k);
  } catch {
    /* storage blocked: nothing saved anyway */
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(NS + "quest-log-media");
      req.onsuccess =
        req.onerror =
        req.onblocked =
          () => {
            resolve();
          };
    } catch {
      resolve();
    }
  });
  location.reload();
}
