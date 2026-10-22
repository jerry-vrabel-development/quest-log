/** Settings dialog: theme, calendar export, backup / restore, reset. */
import { buildIcs } from "../core/ics";
import type { State } from "../core/types";
import { $, download } from "./dom";
import { updateNotifUI } from "./reminders";
import { render } from "./render";
import { S, reset, save, setState, today } from "./store";
import { pushState } from "./sync";
import { toast } from "./toast";

const THEMES: readonly State["theme"][] = ["", "light", "dark"];

export function applyTheme(): void {
  const root = document.documentElement;
  if (S.theme) root.dataset.theme = S.theme;
  else delete root.dataset.theme;
  $<HTMLSelectElement>("#themeSel").value = S.theme;
}

async function restore(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data: unknown = JSON.parse(await file.text());
    if (!data || typeof data !== "object" || !Array.isArray((data as { quests?: unknown }).quests)) {
      throw new Error("not a Quest Log backup");
    }
    if (!confirm("Replace your current quests, XP and loot with this backup?")) return;
    setState(data);
    save();
    void pushState(true);
    applyTheme();
    render();
    toast("restored", "Backup loaded", `${S.quests.length} quests, ${S.xp} XP.`);
  } catch {
    alert("That file couldn't be read as a Quest Log backup.");
  } finally {
    input.value = "";
  }
}

export function initSettings(): void {
  $("#settingsBtn").onclick = () => {
    updateNotifUI();
    $<HTMLDialogElement>("#settings").showModal();
  };
  $("#themeSel").onchange = (e) => {
    const v = (e.target as HTMLSelectElement).value as State["theme"];
    S.theme = THEMES.includes(v) ? v : "";
    save();
    applyTheme();
  };
  $("#icsAll").onclick = () => {
    const qs = S.quests.filter((q) => q.due && !q.done);
    if (!qs.length) {
      toast("calendar", "Nothing scheduled", "Give a quest a date first.");
      return;
    }
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
    $<HTMLDialogElement>("#settings").close();
  };
}
