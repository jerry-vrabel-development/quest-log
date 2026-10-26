/**
 * "Share how I'm doing": builds a short update from the record (src/core/report.ts), lets you edit
 * it, then hands it to the phone's share sheet (Messages, etc.) or copies it. Nothing is sent by the
 * app itself, and nothing leaves until you tap Share or Copy.
 */
import {
  DEFAULT_INCLUDE,
  INCLUDE_KEYS,
  buildReport,
  type Include,
  type IncludeKey,
  type Period,
  type Tone,
} from "../core/report";
import { $, el, isCancel } from "./dom";
import { getMedia } from "./media";
import { S, today } from "./store";

const LABEL: Record<IncludeKey, string> = {
  mood: "How I've been (in words)",
  wins: "What I got done",
  sleep: "Sleep",
  energy: "Energy",
  highlight: "A highlight moment",
  anxiety: "Anxiety",
  pain: "Pain",
  notes: "My latest note",
};

const dialog = () => $<HTMLDialogElement>("#shareDialog");
const form = () => $<HTMLFormElement>("#shareForm");
let highlightId: string | undefined;

function choice<T extends string>(name: string, fallback: T): T {
  return (form().querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? fallback) as T;
}

function include(): Include {
  const out = { ...DEFAULT_INCLUDE };
  for (const k of INCLUDE_KEYS) out[k] = $<HTMLInputElement>(`#share-${k}`).checked;
  return out;
}

/** Rewrites the message from the current choices. */
function compose(): void {
  const r = buildReport(S, {
    period: choice<Period>("period", "week"),
    tone: choice<Tone>("tone", "more"),
    include: include(),
    today: today(),
  });
  $<HTMLTextAreaElement>("#shareText").value = r.text;
  highlightId = r.highlight?.kind === "photo" ? r.highlight.id : undefined;
  $("#sharePhotoRow").hidden = !highlightId;
  $("#shareStatus").textContent = r.text ? "" : "Nothing in this period yet. Try a longer one, or write your own.";
}

export function openShare(): void {
  form().reset();
  for (const k of INCLUDE_KEYS) $<HTMLInputElement>(`#share-${k}`).checked = DEFAULT_INCLUDE[k];
  compose();
  dialog().showModal();
}

async function copy(): Promise<void> {
  const status = $("#shareStatus");
  try {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>("#shareText").value);
    status.textContent = "Copied. Paste it into your message.";
  } catch {
    $<HTMLTextAreaElement>("#shareText").select();
    status.textContent = "Couldn't copy automatically: the text is selected, so copy it from there.";
  }
}

async function send(): Promise<void> {
  const text = $<HTMLTextAreaElement>("#shareText").value.trim();
  if (!text) {
    $("#shareStatus").textContent = "Write something first.";
    return;
  }
  if (!("share" in navigator)) {
    await copy();
    return;
  }
  const data: ShareData = { text };
  if (highlightId && $<HTMLInputElement>("#sharePhoto").checked) {
    const blob = await getMedia(highlightId);
    const file = blob ? new File([blob], "highlight.jpg", { type: blob.type || "image/jpeg" }) : null;
    if (file && navigator.canShare({ files: [file] })) data.files = [file];
  }
  try {
    await navigator.share(data);
    $("#shareStatus").textContent = "Shared.";
  } catch (e) {
    // Closing the share sheet isn't an error; anything else falls back to Copy.
    if (!(e instanceof DOMException && e.name === "AbortError")) await copy();
  }
}

export function initShare(): void {
  const box = $("#shareInclude");
  for (const k of INCLUDE_KEYS) {
    const label = el("label");
    const input = el("input");
    input.type = "checkbox";
    input.id = `share-${k}`;
    label.append(input, ` ${LABEL[k]}`);
    box.append(label);
  }
  form().addEventListener("change", (e) => {
    if (e.target instanceof HTMLInputElement && e.target.id !== "sharePhoto") compose();
  });
  form().addEventListener("submit", (e) => {
    e.preventDefault();
    if (isCancel(e)) dialog().close();
  });
  $("#shareCopy").onclick = () => void copy();
  $("#shareSend").onclick = () => void send();
}
