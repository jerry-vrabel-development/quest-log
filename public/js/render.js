// @ts-check
/** Renders the HUD and the current tab. */
import { daysBetween } from "./core/dates.js";
import { byCategory, nowView, rollMissed, upcoming } from "./core/quests.js";
import { MOODS, MOOD_LOW, MOOD_XP, level, moodLabel, streak } from "./core/rules.js";
import { logMood, setQuestDone } from "./actions.js";
import { $, el, fmtClock, fmtDue, REPEAT_LABEL } from "./dom.js";
import { openEditor } from "./editor.js";
import { renderJourney } from "./journey.js";
import { updateNotifUI } from "./reminders.js";
import { S, saveLocal, today } from "./store.js";

/** @typedef {import("./core/types.js").Quest} Quest */

/** @typedef {"now" | "upcoming" | "all" | "loot" | "journey"} View */
/** @type {View} */
let view = "now";
/** @param {View} v */
export function setView(v) {
  view = v;
  render();
}

/** @param {Quest} q @param {string} t */
function questRow(q, t) {
  const late = !q.done && q.due && q.due < t;
  const row = el("div", "q" + (q.done ? " done" : "") + (late ? " late" : ""));
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = q.done;
  cb.setAttribute("aria-label", "Complete " + q.name);
  cb.onchange = () => setQuestDone(q, cb.checked);

  const body = el("div", "t");
  body.onclick = () => openEditor(q);
  body.append(el("div", "name", q.name));
  if (q.tiny && !q.done) body.append(el("div", "tiny", "Tiny step: " + q.tiny));
  const meta = el("div", "meta");
  if (q.due && !q.done) meta.append(el("span", "chip" + (late ? " warn" : ""), fmtDue(q, t)));
  if (q.repeat && q.repeat !== "none") {
    meta.append(el("span", "chip plain", "↻ " + REPEAT_LABEL[q.repeat] + (q.count ? ` · ${q.count}×` : "")));
  }
  if (q.g) meta.append(el("span", "chip plain", q.g));
  body.append(meta);

  row.append(cb, body, el("span", "xp", "+" + q.xp));
  return row;
}

/** @param {HTMLElement} box @param {string} title @param {Quest[]} list @param {{ cls?: string, empty?: string, t: string }} o */
function section(box, title, list, { cls = "", empty = "", t }) {
  if (!list.length && !empty) return;
  box.append(el("h3", cls, title));
  if (!list.length) box.append(el("div", "empty", empty));
  for (const q of list) box.append(questRow(q, t));
}

function renderHud(t) {
  const lv = level(S.xp);
  $("#lvl").textContent = "Level " + lv.l;
  $("#xp").textContent = `${S.xp} XP · ${lv.into}/${lv.need} to next`;
  $("#bar").style.width = (lv.into / lv.need) * 100 + "%";
  const st = streak(S.days, t);
  $("#streak").textContent = st ? `🔥 ${st}-day streak` : "Start a streak today";
  $("#today-count").textContent = S.days.includes(t) ? "You moved today ✓" : "";
}

/** @param {HTMLElement} box @param {string} t */
function renderNow(box, t) {
  box.append(moodCard(t));
  const v = nowView(S.quests, t);
  if (v.overdue.length) section(box, "Overdue — no guilt, just pick one", v.overdue, { cls: "overdue", t });
  section(box, "Today", v.today, {
    t,
    empty: v.overdue.length ? "" : "Nothing scheduled today. Grab an anytime quest below.",
  });
  section(box, "Anytime", v.anytime, { t });
  if (!v.overdue.length && !v.today.length && !v.anytime.length) {
    box.append(el("div", "empty", "All clear. Add a quest or take Bash out."));
  }
}

/** @param {HTMLElement} box @param {string} t */
function renderUpcoming(box, t) {
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

/** @param {HTMLElement} box @param {string} t */
function renderAll(box, t) {
  const groups = byCategory(S.quests);
  for (const g of Object.keys(groups).sort()) section(box, g, groups[g], { t });
  const done = S.quests.filter((q) => q.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  if (done.length) section(box, `Done (${done.length})`, done.slice(0, 30), { t });
}

/** @param {HTMLElement} box */
function renderLoot(box) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const i of S.inv) counts[i.rar] = (counts[i.rar] || 0) + 1;
  const summary =
    S.inv.length ? ` · ${counts.legendary || 0} legendary, ${counts.epic || 0} epic, ${counts.rare || 0} rare` : "";
  box.append(el("h3", "", `Loot bag · ${S.inv.length} items${summary}`));
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

/** @param {string} t */
function moodCard(t) {
  const todays = S.moods.filter((m) => m.day === t);
  const last = todays[todays.length - 1];
  const card = el("div", "mood-card");

  const head = el("div", "mood-head");
  head.append(el("b", "", last ? "Today's mood" : "How are you right now?"));
  head.append(
    el(
      "span",
      "hint",
      last ? `Checked in ${fmtClock(last.at)}. Tap to update.` : `+${MOOD_XP} XP for any honest answer.`,
    ),
  );
  card.append(head);

  const row = el("div", "mood-row");
  for (const m of MOODS) {
    const b = el("button", "mood-btn" + (last && last.v === m.v ? " on" : ""), String(m.v));
    b.type = "button";
    b.setAttribute("aria-label", `${m.v} out of 10, ${m.label}`);
    b.title = m.label;
    b.style.setProperty("--lvl", (m.v - 1) / 9);
    b.onclick = () => logMood(m.v);
    row.append(b);
  }
  card.append(row);

  const ends = el("div", "mood-ends");
  ends.append(
    el("span", "", "1 · can always go lower"),
    el("span", "now-label", last ? `${last.v} · ${moodLabel(last.v)}` : ""),
    el("span", "", "10 · theoretical"),
  );
  card.append(ends);
  if (last && last.v <= MOOD_LOW) {
    card.append(
      el(
        "p",
        "mood-care",
        "Thanks for being honest. On days like this, one tiny quest is plenty: water, food, or a few minutes outside with Bash. If it gets heavy, call or text 988.",
      ),
    );
  }
  return card;
}

export function render() {
  const t = today();
  // Saved locally only (no updatedAt bump), so it can't make this device look newer than the server.
  if (rollMissed(S.quests, t)) saveLocal();
  renderHud(t);

  document
    .querySelectorAll(".tabs button")
    .forEach((b) => b.classList.toggle("on", /** @type {HTMLElement} */ (b).dataset.view === view));
  const box = $("#view");
  box.replaceChildren();
  if (view === "now") renderNow(box, t);
  else if (view === "upcoming") renderUpcoming(box, t);
  else if (view === "all") renderAll(box, t);
  else if (view === "loot") renderLoot(box);
  else renderJourney(box, t);
  updateNotifUI();
}
