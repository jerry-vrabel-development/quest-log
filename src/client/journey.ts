/** The Journey tab: stat tiles, 14-day charts, badges, best days, categories and the activity log. */
import { addDays } from "../core/dates";
import { moodLabel } from "../core/rules";
import { BADGES, computeStats, moodByDay, type Stats } from "../core/stats";
import type { LogEvent } from "../core/types";
import { el, fmtClock, fmtDay, fmtWeekdayNarrow } from "./dom";
import { openMoodEditor } from "./moodEdit";
import { S } from "./store";

const CHART_DAYS = 14;

/** A focusable chart column with a tooltip. */
function chartCol(tip: string, d: string, t: string) {
  const col = el("div", "col");
  col.tabIndex = 0;
  col.title = tip;
  col.setAttribute("aria-label", tip);
  col.dataset.tip = tip;
  return { col, label: el("span", "x" + (d === t ? " now" : ""), fmtWeekdayNarrow(d)) };
}

function tiles(box: HTMLElement, st: Stats): void {
  const wrap = el("div", "tiles");
  const items: [string, string | number][] = [
    ["Quests done", st.quests],
    ["Best streak", st.bestStreak + (st.bestStreak === 1 ? " day" : " days")],
    ["Loot found", st.loot],
    ["Badges", `${Object.keys(S.badges).length}/${BADGES.length}`],
  ];
  for (const [k, v] of items) {
    const d = el("div", "tile");
    d.append(el("span", "tv", String(v)), el("span", "tk", k));
    wrap.append(d);
  }
  box.append(wrap);
}

function xpChart(box: HTMLElement, st: Stats, days: string[], t: string): void {
  box.append(el("h3", "", `XP per day · last ${CHART_DAYS} days`));
  const max = Math.max(10, ...days.map((d) => st.xpByDay[d] || 0));
  const bars = el("div", "chart bars");
  for (const d of days) {
    const v = st.xpByDay[d] || 0;
    const { col, label } = chartCol(`${fmtDay(d)}: ${v} XP, ${st.countByDay[d] || 0} quests`, d, t);
    const bar = el("i", "bar-mark");
    bar.style.height = v ? Math.max(4, (v / max) * 100) + "%" : "0";
    col.append(bar, label);
    bars.append(col);
  }
  box.append(bars);
}

function moodChart(box: HTMLElement, st: Stats, days: string[], t: string): void {
  const moods = moodByDay(S.moods);
  box.append(el("h3", "", `Mood · last ${CHART_DAYS} days`));
  if (!Object.keys(moods).length) {
    box.append(el("div", "empty", "No check-ins yet. Use the mood card on the Now tab."));
    return;
  }
  const chart = el("div", "chart moods");
  for (const d of days) {
    const m = moods[d];
    const tip =
      m ? `${fmtDay(d)}: ${m.v}/10 · ${moodLabel(m.v)}${m.note ? " · " + m.note : ""}` : `${fmtDay(d)}: no check-in`;
    const { col, label } = chartCol(tip, d, t);
    const dot = el("i", "dot" + (m ? "" : " none"));
    if (m) dot.style.bottom = ((m.v - 1) / 9) * 100 + "%";
    const lane = el("div", "lane");
    lane.append(dot);
    col.append(lane, label);
    chart.append(col);
  }
  const axis = el("div", "mood-axis");
  axis.append(el("span", "", "10"), el("span", "", "5"), el("span", "", "1"));
  const wrap = el("div", "mood-wrap");
  wrap.append(axis, chart);
  box.append(wrap);

  // mood vs activity insight, once there's enough data on both sides
  const withQuest: number[] = [];
  const without: number[] = [];
  for (const [d, m] of Object.entries(moods)) if (m) ((st.countByDay[d] || 0) > 0 ? withQuest : without).push(m.v);
  if (withQuest.length >= 3 && without.length >= 3) {
    const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    box.append(
      el(
        "p",
        "insight",
        `Average mood on days you finished a quest: ${avg(withQuest)} / 10. On days you didn't: ${avg(without)} / 10.`,
      ),
    );
  }
}

function badges(box: HTMLElement): void {
  box.append(el("h3", "", "Badges"));
  const grid = el("div", "badges");
  for (const [id, icon, name, desc] of BADGES) {
    const got = S.badges[id];
    const b = el("div", "badge" + (got ? " got" : ""));
    b.append(
      el("span", "bi", got ? icon : "🔒"),
      el("b", "", name),
      el("small", "", got ? `Earned ${new Date(got).toLocaleDateString()}` : desc),
    );
    grid.append(b);
  }
  box.append(grid);
}

function hallOfFame(box: HTMLElement, st: Stats, t: string): void {
  box.append(el("h3", "", "Hall of fame · your best days"));
  const best = Object.entries(st.xpByDay)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (!best.length) {
    box.append(el("div", "empty", "Your best days will show up here. The only person on this leaderboard is you."));
    return;
  }
  const ol = el("ol", "fame");
  best.forEach(([d, v], i) => {
    const li = el("li", d === t ? "now" : "");
    li.append(el("span", "rk", ["🥇", "🥈", "🥉", "4", "5"][i]), el("span", "", fmtDay(d)), el("b", "", `${v} XP`));
    ol.append(li);
  });
  box.append(ol);
}

function categories(box: HTMLElement, st: Stats): void {
  const entries = Object.entries(st.byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;
  box.append(el("h3", "", "Quests by area"));
  const max = entries[0][1];
  const cats = el("div", "cats");
  for (const [c, n] of entries) {
    const row = el("div", "cat");
    const track = el("div", "track");
    const fill = el("i");
    fill.style.width = (n / max) * 100 + "%";
    track.append(fill);
    row.append(el("span", "cn", c), track, el("span", "cv", String(n)));
    cats.append(row);
  }
  box.append(cats);
}

function describeEvent(e: LogEvent): string {
  switch (e.t) {
    case "quest":
      return `✓ ${e.name}${e.via === "claude" ? " · via Claude" : ""}`;
    case "freeze":
      return e.step ? `🧊 Broke the freeze: ${e.step}` : "🧊 Broke the freeze";
    case "badge":
      return `🏅 Badge: ${e.name}`;
    case "mood":
      return `◐ Mood ${e.v}/10 · ${moodLabel(e.v)}${e.note ? " · " + e.note : ""}`;
  }
}

function activityLog(box: HTMLElement, t: string): void {
  box.append(el("h3", "", "Activity log"));
  if (!S.log.length) box.append(el("div", "empty", "Everything you do will be logged here."));
  const ul = el("ul", "log");
  let lastDay = "";
  for (const e of S.log.slice(0, 60)) {
    if (e.day !== lastDay) {
      lastDay = e.day;
      ul.append(el("li", "log-day", e.day === t ? "Today" : fmtDay(e.day)));
    }
    const li = el("li");
    li.append(el("span", "lt", fmtClock(e.at)), el("span", "lx", describeEvent(e)));
    if (e.xp) li.append(el("span", "xp", "+" + e.xp));
    if (e.t === "mood") {
      const edit = el("button", "log-edit", "✎");
      edit.type = "button";
      edit.setAttribute("aria-label", `Edit mood check-in at ${fmtClock(e.at)}`);
      edit.onclick = () => {
        openMoodEditor(e.at);
      };
      li.append(edit);
    }
    ul.append(li);
  }
  box.append(ul);
}

export function renderJourney(box: HTMLElement, t: string): void {
  const st = computeStats(S, t);
  const days = Array.from({ length: CHART_DAYS }, (_, i) => addDays(t, i - (CHART_DAYS - 1)));
  tiles(box, st);
  xpChart(box, st, days, t);
  moodChart(box, st, days, t);
  badges(box);
  hallOfFame(box, st, t);
  categories(box, st);
  activityLog(box, t);
}

/** One shared tooltip for every chart column (hover, focus or tap). */
export function initChartTooltips(): void {
  const tip = el("div", "chart-tip");
  tip.hidden = true;
  document.body.append(tip);
  const colFrom = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>(".chart .col") : null);
  const show = (e: Event) => {
    const c = colFrom(e);
    if (!c) return;
    const r = c.getBoundingClientRect();
    tip.textContent = c.dataset.tip ?? "";
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(r.left + r.width / 2, 130), innerWidth - 130) + "px";
    tip.style.top = r.top - 6 + "px";
  };
  const hide = () => (tip.hidden = true);
  document.addEventListener("pointerover", show);
  document.addEventListener("focusin", show);
  document.addEventListener("pointerout", (e) => colFrom(e) && hide());
  document.addEventListener("scroll", hide, { passive: true });
}
