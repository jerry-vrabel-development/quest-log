/**
 * Moments in the app: save a photo, a short video, a song (with its music file, if you like), a
 * recording or a movie (capture when things are good), see them in Journey, and get them back as memory drops
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
  needsShrink,
  videoProblem,
  videoTooBig,
} from "../core/moments";
import type { Moment, MomentKind } from "../core/types";
import { $, el, fmtDay, isCancel } from "./dom";
import { backupSoon, removeBackup } from "./backup";
import {
  deleteMedia,
  fixDuration,
  hasLocalMedia,
  resizePhoto,
  saveMedia,
  showPhoto,
  showPlayable,
  videoInfo,
} from "./media";
import { render } from "./render";
import { S, save, today } from "./store";
import { canShrink, shrinkVideo } from "./videoShrink";

const dialog = () => $<HTMLDialogElement>("#momentDialog");
const form = () => $<HTMLFormElement>("#momentForm");
const KINDS: MomentKind[] = ["photo", "video", "song", "recording", "movie"];
const kindNow = (): MomentKind => {
  const v = form().querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value;
  return KINDS.find((k) => k === v) ?? "photo";
};
const TITLE_LABEL: Record<MomentKind, string> = {
  photo: "",
  video: "",
  song: "Song name",
  movie: "Title",
  recording: "What is it? (optional)",
};

/** The file chosen or recorded in the open dialog, for each kind that has one. */
const picked: { photo: Blob | null; video: Blob | null; song: Blob | null; recording: Blob | null } = {
  photo: null,
  video: null,
  song: null,
  recording: null,
};

const FILE_NOUN: Record<MomentKind, string> = {
  photo: "Photo",
  video: "Video",
  song: "Music file",
  recording: "Recording",
  movie: "File",
};

/** Bumped each time a video is picked, so a slower, older shrink can't overwrite a newer pick. */
let videoPick = 0;
let shrinking = false;

/** Memory drops can show a moment only if its photo or recording is on this device. */
export const momentAvailable = (m: Memory): boolean => !m.moment || canShow(m.moment, hasLocalMedia);

function syncKind(): void {
  const kind = kindNow();
  for (const sec of form().querySelectorAll<HTMLElement>(".moment-section")) {
    sec.hidden = !(sec.dataset.for ?? "").split(" ").includes(kind);
  }
  $("#momentTitleLabel").textContent = TITLE_LABEL[kind];
}

function setPreview(player: HTMLMediaElement, blob: Blob | null): void {
  if (player.src) URL.revokeObjectURL(player.src);
  if (blob) {
    fixDuration(player);
    player.src = URL.createObjectURL(blob);
  } else player.removeAttribute("src");
  player.hidden = !blob;
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
  picked.photo = picked.video = picked.song = picked.recording = null;
  const preview = $<HTMLImageElement>("#momentPreview");
  preview.hidden = true;
  preview.removeAttribute("src");
  setPreview($<HTMLAudioElement>("#momentAudioPreview"), null);
  setPreview($<HTMLAudioElement>("#recordPreview"), null);
  setPreview($<HTMLVideoElement>("#momentVideoPreview"), null);
  videoPick++;
  shrinking = false;
  $("#videoStatus").textContent = "";
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
  if (isCancel(e)) {
    dialog().close();
    return;
  }
  const err = $("#momentError");
  const kind = kindNow();
  if (recorder) {
    err.textContent = "Stop the recording first.";
    return;
  }
  if (kind === "video" && shrinking) {
    err.textContent = "One moment: the video is still getting smaller.";
    return;
  }
  const file = kind === "movie" ? null : picked[kind];
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
      audio: !!file && (kind === "song" || kind === "recording"),
      video: !!file && kind === "video",
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
  if (file) void backupSoon();
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
    el("span", "hint", "A photo or a quick video, the song that's playing, a recording, what you're watching."),
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
  void showPlayable(audio, m.id);
  return audio;
}

/** A player for a video moment: never plays by itself, and stays in the page on phones (no forced full screen). */
function videoPlayer(m: Moment): HTMLVideoElement {
  const video = el("video", "moment-video");
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.setAttribute("aria-label", `Play the video from ${fmtDay(m.day)}${m.caption ? `: ${m.caption}` : ""}`);
  void showPlayable(video, m.id);
  return video;
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
  if (m.kind === "video") {
    box.append(videoPlayer(m));
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
        "Photos, videos, songs, recordings and movies you save show up here, and come back on days you need them.",
      ),
    );
    return;
  }
  const grid = el("ul", "moments");
  for (const m of list) {
    const li = el("li", `moment moment-${m.kind}`);
    const media = el("div", "moment-media");
    if (canShow(m, hasLocalMedia)) momentMedia(media, m);
    else media.append(el("span", "hint", `${FILE_NOUN[m.kind]} saved on another device`));
    const del = el("button", "note-del", "×");
    del.type = "button";
    del.setAttribute("aria-label", `Delete moment from ${fmtDay(m.day)}`);
    del.onclick = () => {
      deleteMoment(S, m.id);
      if (hasMedia(m)) {
        void deleteMedia(m.id);
        void removeBackup(m.id);
      }
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

  $<HTMLInputElement>("#momentVideoFile").onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    const preview = $<HTMLVideoElement>("#momentVideoPreview");
    const status = $("#videoStatus");
    const pick = ++videoPick;
    err.textContent = status.textContent = "";
    picked.video = null;
    shrinking = false;
    setPreview(preview, null);
    if (!file) return;
    const info = await videoInfo(file);
    const problem = videoProblem(info.seconds);
    if (problem) {
      err.textContent = problem;
      input.value = "";
      return;
    }
    let clip: Blob = file;
    if (needsShrink(file.size, info.width, info.height) && canShrink()) {
      shrinking = true;
      const total = Math.round(info.seconds);
      status.textContent = "Making it smaller for your phone…";
      try {
        clip = await shrinkVideo(file, (done) => {
          if (pick !== videoPick) return;
          const left = Math.max(0, Math.ceil(total * (1 - done)));
          status.textContent = `Making it smaller for your phone… ${String(left)} s left`;
        });
      } catch {
        clip = file; // couldn't shrink here: try the original
      }
      if (pick !== videoPick) return; // another video was picked, or the dialog was closed
      shrinking = false;
      status.textContent =
        clip === file ? "" : `Ready: ${String(Math.max(1, Math.round(clip.size / (1024 * 1024))))} MB.`;
    }
    const tooBig = videoTooBig(clip.size);
    if (tooBig) {
      err.textContent = tooBig;
      status.textContent = "";
      input.value = "";
      return;
    }
    picked.video = clip;
    setPreview(preview, clip);
  };

  $("#recordBtn").onclick = () => {
    err.textContent = "";
    if (recorder) stopRecording();
    else void startRecording();
  };

  form().addEventListener("submit", (e) => {
    void onSubmit(e);
  });
  dialog().addEventListener("close", () => {
    stopRecording();
    videoPick++; // drop any shrink still running for this dialog
    shrinking = false;
  });
}
