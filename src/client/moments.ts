/**
 * Moments in the app: save a photo, a song or a movie (capture when things are good), see them in
 * Journey, and get them back as memory drops (replay when things aren't).
 */
import type { Memory } from "../core/memories";
import { addMoment, deleteMoment, describeMoment, makeMoment } from "../core/moments";
import type { Moment, MomentKind } from "../core/types";
import { $, el, fmtDay } from "./dom";
import { deletePhoto, hasPhoto, resizePhoto, savePhoto, showPhoto } from "./media";
import { render } from "./render";
import { S, save, today } from "./store";

const dialog = () => $<HTMLDialogElement>("#momentDialog");
const form = () => $<HTMLFormElement>("#momentForm");
const kindNow = (): MomentKind => {
  const v = form().querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value;
  return v === "song" || v === "movie" ? v : "photo";
};
let photo: Blob | null = null;

/** Memory drops can show a moment only if its photo (if any) is on this device. */
export const momentAvailable = (m: Memory): boolean => !m.moment || m.moment.kind !== "photo" || hasPhoto(m.moment.id);

function syncKind(): void {
  const kind = kindNow();
  $("#momentDialog .moment-photo").hidden = kind !== "photo";
  $("#momentDialog .moment-link").hidden = kind === "photo";
  $("#momentTitleLabel").textContent = kind === "song" ? "Song name" : "Title";
}

/** Opens "Save a moment". With `invite`, it's the prompt after a good moment. */
export function openMomentDialog({ invite = false }: { invite?: boolean } = {}): void {
  form().reset();
  photo = null;
  const preview = $<HTMLImageElement>("#momentPreview");
  preview.hidden = true;
  preview.removeAttribute("src");
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
  if (kind === "photo" && !photo) {
    err.textContent = "Choose a photo first.";
    return;
  }
  const result = makeMoment(
    {
      kind,
      caption: $<HTMLTextAreaElement>("#momentCaption").value,
      title: $<HTMLInputElement>("#momentTitleInput").value,
      link: $<HTMLInputElement>("#momentLink").value,
      area: $<HTMLSelectElement>("#momentArea").value,
    },
    { id: crypto.randomUUID(), today: today(), now: Date.now() },
  );
  if ("error" in result) {
    err.textContent = result.error;
    return;
  }
  try {
    if (photo) await savePhoto(result.moment.id, photo);
  } catch {
    err.textContent = "Couldn't save the photo on this device. Is storage full?";
    return;
  }
  addMoment(S, result.moment);
  if (S.momentInvite?.day === today()) S.momentInvite.dismissed = true;
  save();
  dialog().close();
  render();
}

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
    el("span", "hint", "A photo, the song that's playing, what you're watching."),
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

/** The photo, link card or title for a moment, into `box`. */
export function momentMedia(box: HTMLElement, m: Moment): void {
  if (m.kind === "photo") {
    const img = el("img", "moment-img");
    img.alt = m.caption || `Photo from ${fmtDay(m.day)}`;
    box.append(img);
    void showPhoto(img, m.id);
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
      el("div", "empty", "Photos, songs and movies you save show up here, and come back on days you need them."),
    );
    return;
  }
  const grid = el("ul", "moments");
  for (const m of list) {
    const li = el("li", `moment moment-${m.kind}`);
    const media = el("div", "moment-media");
    if (m.kind !== "photo" || hasPhoto(m.id)) momentMedia(media, m);
    else media.append(el("span", "hint", "Photo saved on another device"));
    const del = el("button", "note-del", "×");
    del.type = "button";
    del.setAttribute("aria-label", `Delete moment from ${fmtDay(m.day)}`);
    del.onclick = () => {
      deleteMoment(S, m.id);
      void deletePhoto(m.id);
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
  $<HTMLInputElement>("#momentFile").onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    const err = $("#momentError");
    err.textContent = "";
    if (!file) return;
    try {
      photo = await resizePhoto(file);
    } catch {
      photo = null;
      err.textContent = "Couldn't open that photo. Try another one.";
      return;
    }
    const preview = $<HTMLImageElement>("#momentPreview");
    preview.src = URL.createObjectURL(photo);
    preview.alt = "Preview of the chosen photo";
    preview.hidden = false;
  };
  form().addEventListener("submit", (e) => {
    void onSubmit(e);
  });
}
