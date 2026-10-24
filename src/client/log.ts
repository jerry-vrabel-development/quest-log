/**
 * The Log: a check-in you start yourself, whenever you like. Nothing prompts for it, and nothing
 * shows today's answer back afterwards (a 2 shouldn't follow you around all day). Mood is the only
 * required tap; anxiety, energy, body and focus, notes on sleep and pain, and a picture or GIF are
 * all optional. The click comes first, then the reward; XP is once a day.
 */
import { LOG_GIF_MAX_BYTES, SCALES, SCALE_KEYS, cleanExtras, type ScaleKey } from "../core/checkin";
import { MOODS } from "../core/rules";
import { logMood } from "./actions";
import { backupSoon } from "./backup";
import { $, el, isCancel } from "./dom";
import { resizePhoto, saveMedia } from "./media";

const dialog = () => $<HTMLDialogElement>("#logDialog");

let mood: number | null = null;
const steps = new Map<ScaleKey, number>();
let picture: Blob | null = null;

/** Paints which buttons are chosen (aria-pressed), in the open dialog only. */
function paint(): void {
  for (const b of $("#logMoodRow").querySelectorAll<HTMLButtonElement>("button")) {
    const on = Number(b.dataset.v) === mood;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  for (const b of $("#logScales").querySelectorAll<HTMLButtonElement>("button")) {
    const key = b.dataset.key as ScaleKey;
    const on = steps.get(key) === Number(b.dataset.v);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.textContent = (on ? "✓ " : "") + (b.dataset.word ?? "");
  }
}

function setPicture(blob: Blob | null): void {
  picture = blob;
  const img = $<HTMLImageElement>("#logPreview");
  if (img.src) URL.revokeObjectURL(img.src);
  if (blob) {
    img.src = URL.createObjectURL(blob);
    img.alt = "Preview of the picture for this check-in";
  } else img.removeAttribute("src");
  img.hidden = !blob;
}

export function openLog(): void {
  $<HTMLFormElement>("#logForm").reset();
  mood = null;
  steps.clear();
  setPicture(null);
  $<HTMLDetailsElement>("#logMore").open = false;
  $("#logError").textContent = "";
  paint();
  dialog().showModal();
}

async function onSave(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  if (isCancel(e)) {
    dialog().close();
    return;
  }
  const err = $("#logError");
  if (mood === null) {
    err.textContent = "Pick a mood number first. That's all it needs.";
    return;
  }
  const extras = cleanExtras({
    ...Object.fromEntries(steps),
    sleep: $<HTMLInputElement>("#logSleep").value,
    pain: $<HTMLInputElement>("#logPain").value,
  });
  let media: string | undefined;
  if (picture) {
    media = crypto.randomUUID();
    try {
      await saveMedia(media, picture);
    } catch {
      err.textContent = "Couldn't save the picture on this device. Is storage full?";
      return;
    }
  }
  const v = mood;
  const note = $<HTMLTextAreaElement>("#logNote").value;
  dialog().close();
  logMood(v, note, media ? { ...extras, media } : extras);
  if (media) void backupSoon();
}

export function initLog(): void {
  const row = $("#logMoodRow");
  for (const m of MOODS) {
    const b = el("button", "mood-btn", String(m.v));
    b.type = "button";
    b.dataset.v = String(m.v);
    b.setAttribute("aria-label", `${String(m.v)} out of 10, ${m.label}`);
    b.title = m.label;
    b.style.setProperty("--lvl", String((m.v - 1) / 9));
    b.onclick = () => {
      mood = m.v;
      $("#logError").textContent = "";
      paint();
    };
    row.append(b);
  }

  const scales = $("#logScales");
  for (const key of SCALE_KEYS) {
    const { name, steps: words } = SCALES[key];
    const group = el("fieldset", "log-scale");
    group.append(el("legend", "", name));
    const buttons = el("div", "log-steps");
    words.forEach((word, i) => {
      const b = el("button", "log-step", word);
      b.type = "button";
      b.dataset.key = key;
      b.dataset.v = String(i + 1);
      b.dataset.word = word;
      b.setAttribute("aria-label", `${name}: ${word}`);
      b.onclick = () => {
        // Tap again to clear: every extra stays optional.
        if (steps.get(key) === i + 1) steps.delete(key);
        else steps.set(key, i + 1);
        paint();
      };
      buttons.append(b);
    });
    group.append(buttons);
    scales.append(group);
  }

  $<HTMLInputElement>("#logFile").onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    const err = $("#logError");
    err.textContent = "";
    setPicture(null);
    if (!file) return;
    if (file.type === "image/gif") {
      if (file.size > LOG_GIF_MAX_BYTES) {
        err.textContent = "That GIF is over 8 MB. Try a smaller one.";
        input.value = "";
        return;
      }
      setPicture(file); // kept as is, so it still moves
      return;
    }
    try {
      setPicture(await resizePhoto(file));
    } catch {
      err.textContent = "Couldn't open that picture. Try another one.";
      input.value = "";
    }
  };

  $("#logBtn").onclick = openLog;
  $<HTMLFormElement>("#logForm").addEventListener("submit", (e) => {
    void onSave(e);
  });
}
