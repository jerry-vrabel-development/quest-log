/** Renders the HUD and the current tab. */
import { daysBetween } from "../core/dates";
import { byCategory, nowView, rollMissed, upcoming } from "../core/quests";
import { bestStreak, level, levelTitle, streak } from "../core/rules";
import { comebackFor } from "../core/streaks";
import type { Quest } from "../core/types";
import { greeting } from "../core/welcome";
import { setQuestDone } from "./actions";
import { $, el, fmtDue, REPEAT_LABEL } from "./dom";
import { openEditor } from "./editor";
import { renderJourney } from "./journey";
import { inviteCard } from "./moments";
import { updateNotifUI } from "./reminders";
import { S, saveLocal, today } from "./store";

export const VIEWS = ["now", "upcoming", "all", "loot", "journey"] as const;
export type View = (typeof VIEWS)[number];
export const isView = (v: unknown): v is View => VIEWS.includes(v as View);

let view: View = "now";
export function setView(v: View): void {
  view = v;
  render();
}

function questRow(q: Quest, t: string): HTMLElement {
  const late = !q.done && q.due && q.due < t;
  const row = el("div", "q" + (q.done ? " done" : "") + (late ? " late" : ""));
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = q.done;
  cb.setAttribute("aria-label", "Complete " + q.name);
  cb.onchange = () => setQuestDone(q, cb.checked);

  // A real button, so the editor opens from the keyboard too (Tab to it, then Enter or Space).
  const body = el("button", "t");
  body.type = "button";
  body.onclick = () => {
    openEditor(q);
  };
  body.append(el("span", "name", q.name));
  if (q.tiny && !q.done) body.append(el("span", "tiny", "Tiny step: " + q.tiny));
  const meta = el("span", "meta");
  if (q.due && !q.done) meta.append(el("span", "chip" + (late ? " warn" : ""), fmtDue(q, t)));
  if (q.repeat !== "none") {
    meta.append(el("span", "chip plain", "↻ " + REPEAT_LABEL[q.repeat] + (q.count ? ` · ${q.count}×` : "")));
  }
  if (q.g) meta.append(el("span", "chip plain", q.g));
  body.append(meta);

  row.append(cb, body, el("span", "xp", "+" + q.xp));
  return row;
}

function section(
  box: HTMLElement,
  title: string,
  list: Quest[],
  { cls = "", empty = "", t }: { cls?: string; empty?: string; t: string },
): void {
  if (!list.length && !empty) return;
  box.append(el("h2", cls, title));
  if (!list.length) box.append(el("div", "empty", empty));
  for (const q of list) box.append(questRow(q, t));
}

/** Current streak with the longest run beside it; on a comeback day, an invitation instead of a zero. */
export function streakLine(t: string): string {
  const st = streak(S.days, t);
  const best = Math.max(bestStreak(S.days), st);
  if (st) return `🔥 ${String(st)}-day streak${best > st ? ` · best ${String(best)}` : ""}`;
  if (comebackFor(S.days, t)) return "🌱 One step starts your comeback";
  return "Start a streak today";
}

function renderHud(t: string): void {
  const lv = level(S.xp);
  $("#lvl").textContent = `Level ${String(lv.l)} · ${levelTitle(lv.l)}`;
  $("#xp").textContent = `${S.xp} XP · ${lv.into}/${lv.need} to next`;
  $("#bar").style.width = (lv.into / lv.need) * 100 + "%";
  $("#streak").textContent = streakLine(t);
  $("#today-count").textContent = S.days.includes(t) ? "You moved today ✓" : "";
  const g = document.querySelector("#greeting");
  if (g) g.textContent = greeting(S.profile?.name, new Date().getHours());
}

function renderNow(box: HTMLElement, t: string): void {
  const invite = inviteCard(t);
  if (invite) box.append(invite);
  const v = nowView(S.quests, t);
  if (v.overdue.length) section(box, "Overdue — no guilt, just pick one", v.overdue, { cls: "overdue", t });
  section(box, "Today", v.today, {
    t,
    empty: v.overdue.length ? "" : "Nothing scheduled today. Grab an anytime quest below.",
  });
  section(box, "Anytime", v.anytime, { t });
  if (!v.overdue.length && !v.today.length && !v.anytime.length) {
    box.append(el("div", "empty", "All clear. Add a quest, or take a well-earned break."));
  }
}

function renderUpcoming(box: HTMLElement, t: string): void {
  const up = upcoming(S.quests, t);
  section(
    box,
    "Next 7 days",
    up.filter((q) => daysBetween(t, q.due) <= 7),
    { t, empty: "Nothing in the next week." },
  );
  section(
    box,
    "Later",
    up.filter((q) => daysBetween(t, q.due) > 7),
    { t },
  );
}

function renderAll(box: HTMLElement, t: string): void {
  const groups = byCategory(S.quests);
  for (const g of Object.keys(groups).sort()) section(box, g, groups[g], { t });
  const done = S.quests.filter((q) => q.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  if (done.length) section(box, `Done (${done.length})`, done.slice(0, 30), { t });
}

function renderLoot(box: HTMLElement): void {
  const counts: Record<string, number> = {};
  for (const i of S.inv) counts[i.rar] = (counts[i.rar] || 0) + 1;
  const summary =
    S.inv.length ? ` · ${counts.legendary || 0} legendary, ${counts.epic || 0} epic, ${counts.rare || 0} rare` : "";
  box.append(el("h2", "", `Loot bag · ${S.inv.length} items${summary}`));
  if (!S.inv.length) box.append(el("div", "empty", "Nothing yet. Complete a quest and roll the dice."));
  const grid = el("div", "inv");
  for (const it of S.inv.slice(0, 120)) {
    const d = el("div", "item r-" + it.rar);
    d.append(el("b", "", it.n), el("span", "", it.d));
    if (it.at) d.append(el("small", "", " " + new Date(it.at).toLocaleDateString()));
    grid.append(d);
  }
  box.append(grid);
}

export function render(): void {
  const t = today();
  // Saved locally only (no updatedAt bump), so it can't make this device look newer than the server.
  if (rollMissed(S.quests, t)) saveLocal();
  renderHud(t);

  for (const b of document.querySelectorAll<HTMLElement>(".tabs button")) {
    const on = b.dataset.view === view;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1; // roving tabindex: Tab reaches the current tab, arrows move between tabs
  }
  const box = $("#view");
  box.setAttribute("aria-labelledby", `tab-${view}`);
  box.replaceChildren();
  if (view === "now") renderNow(box, t);
  else if (view === "upcoming") renderUpcoming(box, t);
  else if (view === "all") renderAll(box, t);
  else if (view === "loot") renderLoot(box);
  else renderJourney(box, t);
  updateNotifUI();
}
