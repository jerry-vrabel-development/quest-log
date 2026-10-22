/**
 * Quest Log: a gamified, ADHD-friendly quest tracker.
 * Entry point: wires up the UI modules and starts the app. Works offline from localStorage;
 * sync and push are optional extras when served by the Worker.
 */
import { breakFreeze, processRewards } from "./actions";
import { $ } from "./dom";
import { initEditor, openEditor } from "./editor";
import { initChartTooltips } from "./journey";
import { checkReminders, initReminders } from "./reminders";
import { isView, render, setView } from "./render";
import { applyTheme, initSettings } from "./settings";
import { load, today } from "./store";
import { initSync, pullState } from "./sync";

const REMINDER_POLL_MS = 30_000;

load();
initEditor();
initReminders();
initSettings();
initSync();
initChartTooltips();

for (const btn of document.querySelectorAll<HTMLElement>(".tabs button")) {
  btn.onclick = () => {
    if (isView(btn.dataset.view)) setView(btn.dataset.view);
  };
}
$("#addBtn").onclick = () => openEditor(null);
$("#freeze").onclick = breakFreeze;
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
