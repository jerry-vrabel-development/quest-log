/** The add / edit quest dialog. */
import { buildIcs, slug } from "../core/ics";
import { DEFAULT_CATEGORY } from "../core/quests";
import { DEFAULT_XP } from "../core/rules";
import { REPEATS, type Quest, type Repeat } from "../core/types";
import { $, download } from "./dom";
import { updateNotifUI } from "./reminders";
import { render } from "./render";
import { S, save, today } from "./store";

/** The editor form's named controls (see index.html). */
interface EditorForm extends HTMLFormElement {
  // `name` clashes with HTMLFormElement.name, so the quest name field is read via elements
  tiny: HTMLInputElement;
  g: HTMLInputElement;
  xp: HTMLSelectElement;
  due: HTMLInputElement;
  time: HTMLInputElement;
  repeat: HTMLSelectElement;
  remind: HTMLSelectElement;
}

const form = () => $<EditorForm>("#editForm");
const nameField = (f: EditorForm) => f.elements.namedItem("name") as HTMLInputElement;
const dialog = () => $<HTMLDialogElement>("#editor");

let editing: Quest | null = null;

/** Opens the editor; pass null to add a new quest. */
export function openEditor(q: Quest | null): void {
  editing = q;
  const f = form();
  $("#edTitle").textContent = q ? "Edit quest" : "New quest";
  nameField(f).value = q ? q.name : "";
  f.tiny.value = q ? q.tiny : "";
  f.g.value = q ? q.g : "";
  f.xp.value = String(q ? q.xp : DEFAULT_XP);
  f.due.value = q ? q.due : "";
  f.time.value = q ? q.time : "";
  f.repeat.value = q ? q.repeat : "none";
  f.remind.value = String(q ? q.remind : 0);
  $("#edDelete").hidden = !q;
  $("#edIcs").hidden = !q?.due;
  const categories = [...new Set(S.quests.map((x) => x.g).filter(Boolean))];
  $("#cats").replaceChildren(...categories.map((c) => Object.assign(document.createElement("option"), { value: c })));
  dialog().showModal();
  // Focus right away. (A delayed focus could yank the cursor back here if you'd already moved on,
  // sending what you typed into the wrong field.)
  nameField(f).focus();
}

function onClose(): void {
  if (dialog().returnValue !== "save") return;
  const f = form();
  const name = nameField(f).value.trim();
  if (!name) return;
  const repeat: Repeat = REPEATS.includes(f.repeat.value as Repeat) ? (f.repeat.value as Repeat) : "none";
  const data = {
    name,
    tiny: f.tiny.value.trim(),
    g: f.g.value.trim() || DEFAULT_CATEGORY,
    xp: Number(f.xp.value),
    due: f.due.value || (repeat !== "none" ? today() : ""), // repeating quests need a start date
    time: f.time.value,
    repeat,
    remind: Number(f.remind.value),
  };
  if (editing) Object.assign(editing, data);
  else S.quests.push({ id: S.nextId++, ...data, done: false, doneAt: null, count: 0 });
  save();
  render();
  if (data.due && data.remind >= 0) updateNotifUI();
}

export function initEditor(): void {
  dialog().addEventListener("close", onClose);
  $("#edDelete").onclick = () => {
    const q = editing;
    if (!q || !confirm(`Delete "${q.name}"?`)) return;
    S.quests = S.quests.filter((x) => x !== q);
    save();
    dialog().close();
    render();
  };
  $("#edIcs").onclick = () => {
    if (editing) download(buildIcs([editing]), slug(editing.name) + ".ics", "text/calendar");
  };
}
