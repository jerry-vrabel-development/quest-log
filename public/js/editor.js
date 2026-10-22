// @ts-check
/** The add / edit quest dialog. */
import { buildIcs, slug } from "./core/ics.js";
import { DEFAULT_CATEGORY } from "./core/quests.js";
import { DEFAULT_XP } from "./core/rules.js";
import { $, download } from "./dom.js";
import { updateNotifUI } from "./reminders.js";
import { render } from "./render.js";
import { S, save, today } from "./store.js";

/** @typedef {import("./core/types.js").Quest} Quest */

/** @type {Quest | null} */
let editing = null;

/** @param {Quest | null} q null to add a new quest */
export function openEditor(q) {
  editing = q;
  const f = $("#editForm");
  $("#edTitle").textContent = q ? "Edit quest" : "New quest";
  f.name.value = q ? q.name : "";
  f.tiny.value = q ? q.tiny : "";
  f.g.value = q ? q.g : "";
  f.xp.value = String(q ? q.xp : DEFAULT_XP);
  f.due.value = q ? q.due : "";
  f.time.value = q ? q.time : "";
  f.repeat.value = q ? q.repeat : "none";
  f.remind.value = String(q ? (q.remind ?? 0) : 0);
  $("#edDelete").hidden = !q;
  $("#edIcs").hidden = !q?.due;
  const cats = $("#cats");
  cats.replaceChildren(
    ...[...new Set(S.quests.map((x) => x.g).filter(Boolean))].map((c) =>
      Object.assign(document.createElement("option"), { value: c }),
    ),
  );
  $("#editor").showModal();
  setTimeout(() => f.name.focus(), 50);
}

function onClose() {
  if ($("#editor").returnValue !== "save") return;
  const f = $("#editForm");
  const name = f.name.value.trim();
  if (!name) return;
  const repeat = f.repeat.value;
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

export function initEditor() {
  $("#editor").addEventListener("close", onClose);
  $("#edDelete").onclick = () => {
    const q = editing;
    if (!q || !confirm(`Delete "${q.name}"?`)) return;
    S.quests = S.quests.filter((x) => x !== q);
    save();
    $("#editor").close();
    render();
  };
  $("#edIcs").onclick = () => editing && download(buildIcs([editing]), slug(editing.name) + ".ics", "text/calendar");
}
