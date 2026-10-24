/**
 * Moments in the app: save a photo, a song (with its music file, if you like), a recording or a
 * movie (capture when things are good), see them in Journey, and get them back as memory drops
 * (replay when things aren't).
 */
import type { Memory } from "../core/memories";
import {
  AUDIO_MAX_BYTES,
  RECORD_MAX_SECONDS,
  addMoment,
  canShow,
  deleteMoment,
  describeMoment,
  hasMedia,
  makeMoment,
  titleFromFileName,
} from "../core/moments";
import type { Moment, MomentKind } from "../core/types";
import { $, el, fmtDay } from "./dom";
import { deleteMedia, hasLocalMedia, resizePhoto, saveMedia, showAudio, showPhoto } from "./media";
import { render } from "./render";
import { S, save, today } from "./store";

const dialog = () => $<HTMLDialogElement>("#momentDialog");
const form = () => $<HTMLFormElement>("#momentForm");
const KINDS: MomentKind[] = ["photo", "song", "recording", "movie"];
const kindNow = (): MomentKind => {
  const v = form().querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value;
  return KINDS.find((k) => k === v) ?? "photo";
};
const TITLE_LABEL: Record<MomentKind, string> = {
  photo: "",
  song: "Song name",
  movie: "Title",
  recording: "What is it? (optional)",
};

/** The file chosen or recorded in the open dialog, for each kind that has one. */
const picked: { photo: Blob | null; song: Blob | null; recording: Blob | null } = {
  photo: null,
  song: null,
  recording: null,
};

/** Memory drops can show a moment only if its photo or recording is on this device. */
export const momentAvailable = (m: Memory): boolean => !m.moment || canShow(m.moment, hasLocalMedia);

function syncKind(): void {
  const kind = kindNow();
  for (const sec of form().querySelectorAll<HTMLElement>(".moment-section")) {
    sec.hidden = !(sec.dataset.for ?? "").split(" ").includes(kind);
  }
  $("#momentTitleLabel").textContent = TITLE_LABEL[kind];
}

function setPreview(audio: HTMLAudioElement, blob: Blob | null): void {
  if (audio.src) URL.revokeObjectURL(audio.src);
  if (blob) audio.src = URL.createObjectURL(blob);
  else audio.removeAttribute("src");
  audio.hidden = !blob;
}

/* ---------- recording ---------- */

let recorder: MediaRecorder | null = null;
let recordTimer: ReturnType<typeof setInterval> | undefined;

/** The best audio format this browser can record (Opus where possible, AAC on Safari). */
function recordingType(): string | undefined {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
}

async function startRecording(): Promise<void> {
  const status = $("#recordStatus");
  const btn = $<HTMLButtonElement>("#recordBtn");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    status.textContent = "Couldn't use the microphone. Check that Quest Log is allowed to use it.";
    return;
  }
  const type = recordingType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    for (const t of stream.getTracks()) t.stop();
    clearInterval(recordTimer);
    picked.recording = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
    setPreview($<HTMLAudioElement>("#recordPreview"), picked.recording);
    btn.textContent = "● Record again";
    btn.setAttribute("aria-pressed", "false");
    status.textContent = "Recorded. Play it back, or record again.";
    recorder = null;
  };
  recorder = rec;
  rec.start();
  btn.textContent = "■ Stop";
  btn.setAttribute("aria-pressed", "true");
  let left = RECORD_MAX_SECONDS;
  status.textContent = "Recording…";
  recordTimer = setInterval(() => {
    left--;
    if (left <= 0) stopRecording();
    else if (left <= 10) status.textContent = `Recording… ${String(left)} s left`;
  }, 1000);
}

function stopRecording(): void {
  if (recorder?.state === "recording") recorder.stop();
}

/* ---------- the dialog ---------- */

/** Opens "Save a moment". With `invite`, it's the prompt after a good moment. */
export function openMomentDialog({ invite = false }: { invite?: boolean } = {}): void {
  form().reset();
  picked.photo = picked.song = picked.recording = null;
  const preview = $<HTMLImageElement>("#momentPreview");
  preview.hidden = true;
  preview.removeAttribute("src");
  setPreview($<HTMLAudioElement>("#momentAudioPreview"), null);
  setPreview($<HTMLAudioElement>("#recordPreview"), null);
  $("#recordBtn").textContent = "● Record";
  $("#recordStatus").textContent = "Up to 2 minutes.";
  $("#momentError").textContent = "";
  $("#momentTitle").textContent = invite ? "Save this moment?" : "Save a moment";
  const areas = [...new Set(S.quests.map((q) => q.g).filter(Boolean))].sort();
  const select = $<HTMLSelectElement>("#momentArea");
  select.replaceChildren(
    Object.assign(document.createElement("option"), { value: "", textContent: "Nothing in particular" }),
    ...areas.map((a) => Object.assign(document.createElement("option"), { value: a, textContent: a })),
  );
  syncKind();
  dialog().showModal();
}

async function onSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const err = $("#momentError");
  const kind = kindNow();
  if (recorder) {
    err.textContent = "Stop the recording first.";
    return;
  }
  const file =
    kind === "photo" ? picked.photo
    : kind === "song" ? picked.song
    : kind === "recording" ? picked.recording
    : null;
  if (kind === "photo" && !file) {
    err.textContent = "Choose a photo first.";
    return;
  }
  const result = makeMoment(
    {
      kind,
      caption: $<HTMLTextAreaElement>("#momentCaption").value,
      title: $<HTMLInputElement>("#momentTitleInput").value,
      link: kind === "song" || kind === "movie" ? $<HTMLInputElement>("#momentLink").value : "",
      area: $<HTMLSelectElement>("#momentArea").value,
      audio: !!file && kind !== "photo",
    },
    { id: crypto.randomUUID(), today: today(), now: Date.now() },
  );
  if ("error" in result) {
    err.textContent = result.error;
    return;
  }
  try {
    if (file) await saveMedia(result.moment.id, file);
  } catch {
    err.textContent = "Couldn't save that on this device. Is storage full?";
    return;
  }
  addMoment(S, result.moment);
  if (S.momentInvite?.day === today()) S.momentInvite.dismissed = true;
  save();
  dialog().close();
  render();
}

/* ---------- invite ---------- */

/** A good moment just happened: invite saving it, at most once a day. */
export function inviteMoment(): void {
  if (S.momentInvite?.day === today()) return;
  S.momentInvite = { day: today(), dismissed: false };
}

/** The "Save this moment?" card on the Now view, if today's invite is open. */
export function inviteCard(t: string): HTMLElement | null {
  if (S.momentInvite?.day !== t || S.momentInvite.dismissed) return null;
  const card = el("section", "moment-invite");
  card.setAttribute("aria-label", "Save this moment");
  card.append(
    el("b", "", "✨ A good moment. Save it?"),
    el("span", "hint", "A photo, the song that's playing, a quick recording, what you're watching."),
  );
  const add = el("button", "btn small", "Add a moment");
  add.type = "button";
  add.onclick = () => {
    openMomentDialog({ invite: true });
  };
  const later = el("button", "btn small ghost", "Not now");
  later.type = "button";
  later.onclick = () => {
    if (S.momentInvite) S.momentInvite.dismissed = true;
    save();
    render();
  };
  const row = el("div", "moment-invite-btns");
  row.append(add, later);
  card.append(row);
  return card;
}

/* ---------- showing moments ---------- */

/** A player for a moment's music file or recording. It never plays by itself. */
function player(m: Moment): HTMLAudioElement {
  const audio = el("audio", "moment-audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.setAttribute(
    "aria-label",
    m.kind === "recording" ? `Play your recording${m.title ? `: ${m.title}` : ""}` : `Play ${m.title ?? "the song"}`,
  );
  void showAudio(audio, m.id);
  return audio;
}

/** The photo, player, link card or title for a moment, into `box`. */
export function momentMedia(box: HTMLElement, m: Moment): void {
  if (m.kind === "photo") {
    const img = el("img", "moment-img");
    img.alt = m.caption || `Photo from ${fmtDay(m.day)}`;
    box.append(img);
    void showPhoto(img, m.id);
    return;
  }
  if (m.kind === "recording") {
    if (m.title) box.append(el("span", "moment-link-card", `🎙️ ${m.title}`));
    box.append(player(m));
    return;
  }
  const icon = m.kind === "song" ? "🎵" : "🎞️";
  const label = `${icon} ${m.title ?? m.source ?? "Link"}${m.source && m.title ? ` · ${m.source}` : ""}`;
  if (m.url) {
    const a = el("a", "moment-link-card", label);
    a.href = m.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    box.append(a);
  } else box.append(el("span", "moment-link-card", label));
  if (m.audio && hasLocalMedia(m.id)) box.append(player(m));
}

/** Replays a moment memory front and center. */
export function showMemoryPop(memory: Memory): void {
  const m = memory.moment;
  if (!m) return;
  const { headline } = describeMoment(m);
  $("#memoryPopLabel").textContent = `From your record · ${fmtDay(m.day)}`;
  $("#memoryPopTitle").textContent = headline;
  const media = $("#memoryPopMedia");
  media.replaceChildren();
  momentMedia(media, m);
  $("#memoryPopCaption").textContent = m.caption;
  $<HTMLDialogElement>("#memoryPop").showModal();
}

/** Journey: your moments, newest first, with a way to add more. */
export function momentsSection(box: HTMLElement): void {
  box.append(el("h2", "", "Moments"));
  const add = el("button", "btn small", "Add a moment");
  add.type = "button";
  add.onclick = () => {
    openMomentDialog();
  };
  box.append(add);
  const list = S.moments ?? [];
  if (!list.length) {
    box.append(
      el(
        "div",
        "empty",
        "Photos, songs, recordings and movies you save show up here, and come back on days you need them.",
      ),
    );
    return;
  }
  const grid = el("ul", "moments");
  for (const m of list) {
    const li = el("li", `moment moment-${m.kind}`);
    const media = el("div", "moment-media");
    if (canShow(m, hasLocalMedia)) momentMedia(media, m);
    else media.append(el("span", "hint", `${m.kind === "photo" ? "Photo" : "Recording"} saved on another device`));
    const del = el("button", "note-del", "×");
    del.type = "button";
    del.setAttribute("aria-label", `Delete moment from ${fmtDay(m.day)}`);
    del.onclick = () => {
      deleteMoment(S, m.id);
      if (hasMedia(m)) void deleteMedia(m.id);
      save();
      render();
    };
    li.append(media, el("span", "note-day", fmtDay(m.day)), el("span", "moment-caption", m.caption), del);
    grid.append(li);
  }
  box.append(grid);
}

export function initMoments(): void {
  for (const r of form().querySelectorAll<HTMLInputElement>('input[name="kind"]')) r.onchange = syncKind;
  const err = $("#momentError");

  $<HTMLInputElement>("#momentFile").onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    err.textContent = "";
    if (!file) return;
    try {
      picked.photo = await resizePhoto(file);
    } catch {
      picked.photo = null;
      err.textContent = "Couldn't open that photo. Try another one.";
      return;
    }
    const preview = $<HTMLImageElement>("#momentPreview");
    preview.src = URL.createObjectURL(picked.photo);
    preview.alt = "Preview of the chosen photo";
    preview.hidden = false;
  };

  $<HTMLInputElement>("#momentAudioFile").onchange = (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    err.textContent = "";
    picked.song = null;
    setPreview($<HTMLAudioElement>("#momentAudioPreview"), null);
    if (!file) return;
    if (file.size > AUDIO_MAX_BYTES) {
      err.textContent = "That file is over 25 MB. Try a shorter clip or a smaller file.";
      input.value = "";
      return;
    }
    picked.song = file;
    setPreview($<HTMLAudioElement>("#momentAudioPreview"), file);
    const title = $<HTMLInputElement>("#momentTitleInput");
    if (!title.value.trim()) title.value = titleFromFileName(file.name);
  };

  $("#recordBtn").onclick = () => {
    err.textContent = "";
    if (recorder) stopRecording();
    else void startRecording();
  };

  form().addEventListener("submit", (e) => {
    void onSubmit(e);
  });
  dialog().addEventListener("close", stopRecording);
}
