/**
 * Quest Log: a gamified, ADHD-friendly quest tracker.
 * Entry point: wires up the UI modules and starts the app. Works offline from localStorage;
 * sync and push are optional extras when served by the Worker.
 */
import { processRewards } from "./actions";
import { initDice, openDice } from "./dice";
import { $ } from "./dom";
import { initEditor, openEditor } from "./editor";
import { initChartTooltips } from "./journey";
import { loadMediaIndex } from "./media";
import { initMoments } from "./moments";
import { initMoodEditor } from "./moodEdit";
import { checkReminders, initReminders } from "./reminders";
import { isView, render, setView } from "./render";
import { initSessionSounds } from "./session";
import { applyTheme, initSettings } from "./settings";
import { load, today } from "./store";
import { DEMO, resetDemo, showDemoBanner } from "./demo";
import { initBackup } from "./backup";
import { initLog } from "./log";
import { initShare } from "./share";
import { initSync, pullState } from "./sync";

const REMINDER_POLL_MS = 30_000;

load();
if (DEMO) {
  document.title = "Quest Log · Demo";
  showDemoBanner(() => void resetDemo());
}
initEditor();
initReminders();
initSettings();
initSync();
initBackup();
initLog();
initShare();
initChartTooltips();
initDice();
initMoodEditor();
initMoments();
initSessionSounds();
// Moment files (photos, audio) live in IndexedDB; once we know which are on this device, refresh the view.
// Saved files are listed in the background; mark the page when that's done (tests wait on it).
void loadMediaIndex().then(() => {
  document.documentElement.dataset.media = "ready";
  render();
});

// The progress panel is sticky; scroll focused items to just below it, never underneath.
const hud = $(".hud");
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--hud-h", `${String(hud.offsetHeight + 16)}px`);
}).observe(hud);

// WAI-ARIA tabs: click or Enter selects; Left/Right (and Home/End) move between tabs.
const tabs = [...document.querySelectorAll<HTMLElement>(".tabs button")];
const selectTab = (btn: HTMLElement) => {
  if (isView(btn.dataset.view)) setView(btn.dataset.view);
};
for (const [i, btn] of tabs.entries()) {
  btn.onclick = () => {
    selectTab(btn);
  };
  btn.onkeydown = (e) => {
    const next =
      e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length]
      : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === "Home" ? tabs[0]
      : e.key === "End" ? tabs.at(-1)
      : undefined;
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    next.focus();
  };
}
$("#addBtn").onclick = () => openEditor(null);
$("#freeze").onclick = openDice;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  render();
  void checkReminders();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

applyTheme();
render();
processRewards();
void pullState();
void checkReminders();
setInterval(() => void checkReminders(), REMINDER_POLL_MS);

// re-render after midnight so "Today" rolls over
let renderedDay = today();
setInterval(() => {
  if (renderedDay === today()) return;
  renderedDay = today();
  render();
}, 60_000);
