// @ts-check
/** Settings dialog: theme, calendar export, backup / restore, reset. */
import { buildIcs } from "./core/ics.js";
import { $, download } from "./dom.js";
import { updateNotifUI } from "./reminders.js";
import { render } from "./render.js";
import { S, reset, save, setState, today } from "./store.js";
import { pushState } from "./sync.js";
import { toast } from "./toast.js";

export function applyTheme() {
  const root = document.documentElement;
  if (S.theme) root.dataset.theme = S.theme;
  else delete root.dataset.theme;
  $("#themeSel").value = S.theme || "";
}

/** @param {Event} e */
async function restore(e) {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.quests)) throw new Error("not a Quest Log backup");
    if (!confirm("Replace your current quests, XP and loot with this backup?")) return;
    setState(data);
    save();
    pushState(true);
    applyTheme();
    render();
    toast("restored", "Backup loaded", `${S.quests.length} quests, ${S.xp} XP.`);
  } catch {
    alert("That file couldn't be read as a Quest Log backup.");
  } finally {
    input.value = "";
  }
}

export function initSettings() {
  $("#settingsBtn").onclick = () => {
    updateNotifUI();
    $("#settings").showModal();
  };
  $("#themeSel").onchange = (/** @type {Event} */ e) => {
    S.theme = /** @type {HTMLSelectElement} */ (e.target).value;
    save();
    applyTheme();
  };
  $("#icsAll").onclick = () => {
    const qs = S.quests.filter((q) => q.due && !q.done);
    if (!qs.length) return toast("calendar", "Nothing scheduled", "Give a quest a date first.");
    download(buildIcs(qs), "quest-log.ics", "text/calendar");
  };
  $("#exportBtn").onclick = () =>
    download(JSON.stringify(S, null, 2), `quest-log-backup-${today()}.json`, "application/json");
  $("#importFile").onchange = restore;
  $("#resetBtn").onclick = () => {
    if (!confirm("Reset all quests, XP and loot? Consider exporting a backup first.")) return;
    reset();
    save();
    applyTheme();
    render();
    $("#settings").close();
  };
}
