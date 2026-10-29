/** The add / edit quest dialog. */
import { buildIcs, slug } from "../core/ics";
import { DEFAULT_CATEGORY } from "../core/quests";
import { describeQuickAdd, parseQuickAdd, understoodSomething, type QuickAdd } from "../core/quickadd";
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
let quick: QuickAdd | null = null;

/** New quests only: shows what the Quest field's words mean as a schedule, without changing anything yet. */
function previewQuick(): void {
  const f = form();
  const box = $("#quickBox");
  quick = editing ? null : parseQuickAdd(nameField(f).value, today());
  if (!quick || !understoodSomething(quick) || !quick.name) {
    box.hidden = true;
    quick = null;
    return;
  }
  $("#quickPreview").textContent = `Understood: ${quick.name} · ${describeQuickAdd(quick, today())}`;
  box.hidden = false;
}

/** Applies the previewed schedule to the form. */
function useQuick(): void {
  const q = quick;
  if (!q) return;
  const f = form();
  nameField(f).value = q.name;
  if (q.due) f.due.value = q.due;
  if (q.time) f.time.value = q.time;
  if (q.repeat) f.repeat.value = q.repeat;
  $("#quickBox").hidden = true;
  quick = null;
  nameField(f).focus();
}

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
  $("#quickHint").hidden = !!q;
  $("#quickBox").hidden = true;
  quick = null;
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
  nameField(form()).addEventListener("input", previewQuick);
  $("#quickUse").onclick = useQuick;
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
