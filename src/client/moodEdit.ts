/**
 * Fix or remove a mood check-in from the Journey activity log.
 * Delete takes two taps (no browser confirm box): "Delete", then "Confirm delete".
 */
import { deleteMood, editMood, NOTE_MAX } from "../core/moods";
import { MOODS } from "../core/rules";
import { removeBackup } from "./backup";
import { $, el, fmtClock, fmtDay } from "./dom";
import { deleteMedia } from "./media";
import { render } from "./render";
import { S, save } from "./store";
import { toast } from "./toast";

const dialog = () => $<HTMLDialogElement>("#moodEdit");
let editing: number | undefined;
let value = 0;
let deleteArmed = false;

function paint(): void {
  for (const b of $("#moodEditRow").querySelectorAll<HTMLButtonElement>(".mood-btn")) {
    const on = Number(b.dataset.v) === value;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}

function armDelete(armed: boolean): void {
  deleteArmed = armed;
  const btn = $("#moodEditDelete");
  btn.textContent = armed ? "Confirm delete" : "Delete";
  btn.classList.toggle("armed", armed);
}

/** Opens the editor for the check-in recorded at `at` (its timestamp is its id). */
export function openMoodEditor(at: number): void {
  const mood = S.moods.find((m) => m.at === at);
  if (!mood) return;
  editing = at;
  value = mood.v;
  $("#moodEditWhen").textContent = `${fmtDay(mood.day)} · ${fmtClock(mood.at)}`;
  $<HTMLTextAreaElement>("#moodEditNote").value = mood.note ?? "";
  paint();
  armDelete(false);
  dialog().showModal();
}

function saveEdit(): void {
  if (editing === undefined) return;
  editMood(S, editing, { v: value, note: $<HTMLTextAreaElement>("#moodEditNote").value });
  save();
  render();
  dialog().close();
}

function remove(): void {
  if (editing === undefined) return;
  if (!deleteArmed) {
    armDelete(true);
    return;
  }
  const media = S.moods.find((m) => m.at === editing)?.media;
  const result = deleteMood(S, editing);
  if (media) {
    void deleteMedia(media);
    void removeBackup(media);
  }
  save();
  render();
  dialog().close();
  if (result?.xpChange)
    toast("mood", "Check-in deleted", `${String(result.xpChange)} XP: that was the day's only check-in.`);
}

export function initMoodEditor(): void {
  const row = $("#moodEditRow");
  for (const m of MOODS) {
    const b = el("button", "mood-btn", String(m.v));
    b.type = "button";
    b.dataset.v = String(m.v);
    b.setAttribute("aria-label", `${String(m.v)} out of 10, ${m.label}`);
    b.title = m.label;
    b.style.setProperty("--lvl", String((m.v - 1) / 9));
    b.onclick = () => {
      value = m.v;
      paint();
    };
    row.append(b);
  }
  $<HTMLTextAreaElement>("#moodEditNote").maxLength = NOTE_MAX;
  $("#moodEditSave").onclick = saveEdit;
  $("#moodEditDelete").onclick = remove;
  dialog().addEventListener("close", () => {
    editing = undefined;
    armDelete(false);
  });
}
