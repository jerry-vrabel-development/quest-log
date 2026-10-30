/**
 * Demo mode (`?demo`): try Quest Log from a fresh start (level 1, nothing logged, the starter
 * quests) without it counting. It's a sandbox: its own browser storage and media database, sync,
 * push and reminders off, so it can never touch a real account or the server. Reset starts over.
 */
export const DEMO = new URLSearchParams(location.search).has("demo");

/** Storage keys and the media database get this prefix in the demo, so real data is never touched. */
export const NS = DEMO ? "quest-log-demo:" : "";

const BANNER_KEY = NS + "demo-banner";

/** Whether the visitor closed the banner (it then stays closed until the demo is reset). */
function bannerClosed(): boolean {
  try {
    return localStorage.getItem(BANNER_KEY) === "closed";
  } catch {
    return false;
  }
}

/**
 * The banner across the top of the demo: what it is, Reset, and the way out. It can be closed,
 * and stays closed; Reset and Leave are in Settings too.
 */
export function showDemoBanner(onReset: () => void): void {
  if (bannerClosed()) return;
  // A labelled landmark, so it's reachable by region navigation like the rest of the page.
  const bar = document.createElement("aside");
  bar.className = "demo-banner";
  bar.setAttribute("aria-label", "Demo");
  const text = document.createElement("span");
  const strong = document.createElement("b");
  strong.textContent = "Demo";
  text.append(
    strong,
    " · a fresh start to play with, kept in this browser only. Nothing here counts; Reset starts over. The real app can also connect to an AI assistant like Claude. Reset and Leave are in Settings too.",
  );
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn small ghost";
  reset.textContent = "Reset demo";
  reset.onclick = onReset;
  const leave = document.createElement("a");
  leave.href = location.pathname;
  leave.className = "btn small ghost";
  leave.textContent = "Leave demo";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn small ghost";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close the demo banner");
  close.onclick = () => {
    try {
      localStorage.setItem(BANNER_KEY, "closed");
    } catch {
      /* storage blocked: closes for this visit only */
    }
    bar.remove();
  };
  const btns = document.createElement("span");
  btns.className = "banner-btns";
  btns.append(reset, leave, close);
  bar.append(text, btns);
  document.body.prepend(bar);
}

/** Throws the demo away (its storage and its files) and starts it over from level 1. */
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
