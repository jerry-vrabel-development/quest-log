// @ts-check
/**
 * Quest Log: a gamified, ADHD-friendly quest tracker.
 * Entry point: wires up the UI modules and starts the app. Works offline from localStorage;
 * sync and push are optional extras when served by the Worker.
 */
import { breakFreeze, processRewards } from "./actions.js";
import { $ } from "./dom.js";
import { initEditor, openEditor } from "./editor.js";
import { initChartTooltips } from "./journey.js";
import { checkReminders, initReminders } from "./reminders.js";
import { render, setView } from "./render.js";
import { applyTheme, initSettings } from "./settings.js";
import { load, today } from "./store.js";
import { initSync, pullState } from "./sync.js";

const REMINDER_POLL_MS = 30_000;

load();
initEditor();
initReminders();
initSettings();
initSync();
initChartTooltips();

document.querySelectorAll(".tabs button").forEach((b) => {
  const btn = /** @type {HTMLElement} */ (b);
  btn.onclick = () => setView(/** @type {any} */ (btn.dataset.view));
});
$("#addBtn").onclick = () => openEditor(null);
$("#freeze").onclick = breakFreeze;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  render();
  checkReminders();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

applyTheme();
render();
processRewards();
pullState();
checkReminders();
setInterval(checkReminders, REMINDER_POLL_MS);

// re-render after midnight so "Today" rolls over
let renderedDay = today();
setInterval(() => {
  if (renderedDay === today()) return;
  renderedDay = today();
  render();
}, 60_000);
