"use strict";
/* Quest Log — a gamified, ADHD-friendly quest tracker.
   No build step, no server: everything lives in this browser's localStorage. */

const KEY = "quest-log-v2";
const NOTIFIED_KEY = "quest-log-notified";
const $ = (s) => document.querySelector(s);

/* ---------- dates (all local time) ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);

function advance(s, repeat) {
  const d = parseYmd(s);
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
  else if (repeat === "weekdays") { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
  return ymd(d);
}
function nextOccurrence(q) {
  let d = advance(q.due, q.repeat);
  const t = today();
  while (d <= t) d = advance(d, q.repeat); // skip missed occurrences, no pile-up
  return d;
}
function fmtDue(q) {
  if (!q.due) return "";
  const diff = daysBetween(today(), q.due);
  let label = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday"
    : diff < 0 ? `${-diff} days ago`
    : diff < 7 ? parseYmd(q.due).toLocaleDateString(undefined, { weekday: "long" })
    : parseYmd(q.due).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (q.time) label += " " + fmtTime(q.time);
  return label;
}
function fmtTime(t) {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
const REPEAT_LABEL = { daily: "every day", weekdays: "weekdays", weekly: "weekly", monthly: "monthly" };

/* ---------- seed quests (dates relative to first launch) ---------- */
function seed() {
  const t = today();
  const Q = (g, name, tiny, xp, extra = {}) => ({ g, name, tiny, xp, ...extra });
  return [
    Q("Health & safety net", "Apply for Healthy Indiana Plan (HIP)", "Call 877-438-4479 or open the FSSA Benefits Portal", 30, { due: addDays(t, 1), time: "10:00" }),
    Q("Health & safety net", "Ask HIP about work-requirement exemptions", "Write the question on a sticky note before you call", 15, { due: addDays(t, 1), time: "10:00" }),
    Q("Health & safety net", "Call 211 about housing, food & help", "Say: \"I lose my housing in December and have a dog\"", 25, { due: addDays(t, 2), time: "10:00" }),
    Q("Bash", "Walk Bash", "Leash on, out the door", 10, { due: t, time: "09:00", repeat: "daily" }),
    Q("Bash", "Take Bash somewhere new and say hi to one person", "\"What's your dog's name?\"", 15, { due: addDays(t, 2), time: "16:00", repeat: "weekly" }),
    Q("Career", "Fix LinkedIn headline", "Open LinkedIn, click the pencil", 15, { due: addDays(t, 3) }),
    Q("Career", "Merge duplicate LinkedIn entries", "Just do Forwardslash first", 20, { due: addDays(t, 4) }),
    Q("Career", "Fix the 'VLMY&R' typo", "30 seconds, go", 5),
    Q("Career", "Rewrite About section in your own voice", "Write the first sentence only", 25),
    Q("Career", "Fix the Google verification placeholder on your site", "Open the HTML head", 10),
    Q("Career", "Apply to one job", "Open one listing and read it", 20, { due: addDays(t, 1), repeat: "weekdays" }),
    Q("Money", "List 3 fast-income options", "Contract recruiting, Drupal contract work, gig work", 15),
    Q("Money", "Find 3 local businesses with outdated websites", "Search one block, one business", 20),
    Q("Next home", "Write down 3 places you'd want to live with Bash", "Just name one", 15, { due: addDays(t, 5) }),
    Q("Next home", "Look up dog-friendly rent for one of them", "One search, one number", 15),
  ];
}

const LOOT = {
  common: [
    ["Bash's Squeaky Ball", "Reward: 10 minutes of guilt-free anything."],
    ["Cup of Good Coffee", "Reward: make or buy the good stuff."],
    ["Small Win Token", "Proof that you moved. That counts."],
    ["Extra Belly Rub", "For Bash. Also kind of for you."],
    ["Clean Commit", "Something got shipped today."],
    ["Open Tab Closed", "One less thing rattling around."],
  ],
  rare: [
    ["Golden Tennis Ball", "Reward: a longer walk somewhere you like."],
    ["Thaw Crystal", "The freeze cracked. Remember how that felt."],
    ["Recruiter's Eye", "You know how hiring works from both sides."],
    ["Mechanical Keyboard of Focus", "Reward: 30 minutes on a fun code side project."],
    ["Good Playlist", "Reward: put on something you love while you work."],
  ],
  epic: [
    ["Employee #75 Badge", "You were there early. You know how to start from small."],
    ["Dot-Com Survivor Shield", "You've rebuilt after a crash before."],
    ["Treat of Champions", "Reward: get yourself a real treat. Bash too."],
  ],
  legendary: [
    ["Crown of Forward Motion", "Reward: a full afternoon off, zero guilt. You earned it."],
  ],
};

// 1-10 scale. The ends are bookends: you can always go lower, and 10 is mostly theoretical.
const MOODS = ["Bottom", "Awful", "Rough", "Low", "Meh", "Okay", "Decent", "Good", "Great", "Peak"]
  .map((label, i) => ({ v: i + 1, label }));
const MOOD_MAX = 10, MOOD_LOW = 4; // 4 and under counts as a low day
const MOOD_XP = 5; // same reward whatever the mood: honesty is the quest

// Badges: each check gets computed stats. Order = display order.
const BADGES = [
  ["first-step", "🥾", "First Step", "Complete your first quest", (s) => s.quests >= 1],
  ["thaw", "🧊", "Thaw", "Use the Frozen? button", (s) => s.freezes >= 1],
  ["check-in", "🫀", "Honest Check-in", "Log your mood for the first time", (s) => s.moodDays >= 1],
  ["low-day-hero", "🛡️", "Low-Day Hero", "Finish a quest on a day your mood was 4 or under", (s) => s.lowDayWins >= 1],
  ["ten-down", "🔟", "Ten Down", "Complete 10 quests", (s) => s.quests >= 10],
  ["bash-bff", "🐕", "Bash's Best Friend", "Complete 10 Bash quests", (s) => (s.byCat["Bash"] || 0) >= 10],
  ["streak-3", "🔥", "Kindling", "3-day streak", (s) => s.bestStreak >= 3],
  ["mood-week", "📓", "Self-Aware", "Log your mood on 7 different days", (s) => s.moodDays >= 7],
  ["streak-7", "🔥", "Campfire", "7-day streak", (s) => s.bestStreak >= 7],
  ["career-10", "💼", "Career Climber", "Complete 10 Career quests", (s) => (s.byCat["Career"] || 0) >= 10],
  ["collector", "🎒", "Collector", "Collect 25 loot items", (s) => s.loot >= 25],
  ["level-5", "⭐", "Level 5", "Reach level 5", (s) => s.level >= 5],
  ["fifty", "🏅", "Half Century", "Complete 50 quests", (s) => s.quests >= 50],
  ["lucky", "👑", "Lucky", "Find a legendary drop", (s) => s.legendary >= 1],
  ["streak-14", "🔥", "Bonfire", "14-day streak", (s) => s.bestStreak >= 14],
  ["mood-month", "🗓️", "Steady Witness", "Log your mood on 30 different days", (s) => s.moodDays >= 30],
  ["level-10", "🌟", "Level 10", "Reach level 10", (s) => s.level >= 10],
  ["centurion", "🏛️", "Centurion", "Complete 100 quests", (s) => s.quests >= 100],
  ["streak-30", "☀️", "Sunrise", "30-day streak", (s) => s.bestStreak >= 30],
];

/* ---------- state ---------- */
let S;
function fresh() {
  let id = 0;
  const quests = seed().map((q) => ({
    id: ++id, g: q.g, name: q.name, tiny: q.tiny || "", xp: q.xp,
    due: q.due || "", time: q.time || "", repeat: q.repeat || "none", remind: 0,
    done: false, doneAt: null, count: 0,
  }));
  return { v: 3, quests, xp: 0, inv: [], dry: 0, nextId: id + 1, days: [], theme: "", log: [], moods: [], badges: {} };
}
function load() {
  try { const r = localStorage.getItem(KEY); S = r ? JSON.parse(r) : fresh(); } catch (e) { S = fresh(); }
  upgrade();
}
function upgrade() {
  if (!S.log) { // first run on v3: backfill the log from quests already finished
    S.log = S.quests.filter((q) => q.done && q.doneAt)
      .map((q) => ({ t: "quest", id: q.id, name: q.name, g: q.g, xp: q.xp, at: q.doneAt, day: ymd(new Date(q.doneAt)) }))
      .sort((a, b) => b.at - a.at);
  }
  S.days = S.days || [];
  // v3 moods were 1-5; spread them onto 1-10 (1→1, 2→3, 3→5, 4→7, 5→9)
  (S.moods || []).forEach((m) => { if (!m.s) { m.v = m.v * 2 - 1; m.s = 10; } });
  (S.log || []).forEach((e) => { if (e.t === "mood" && !e.s) { e.v = e.v * 2 - 1; e.s = 10; } }); S.moods = S.moods || []; S.badges = S.badges || {};
}
function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function save() { S.updatedAt = Date.now(); saveLocal(); scheduleSync(); }

/* ---------- XP, levels, streak, loot ---------- */
function level(xp) {
  let l = 1, need = 50, acc = 0;
  while (xp >= acc + need) { acc += need; l++; need = Math.round(need * 1.25); }
  return { l, into: xp - acc, need };
}
function markActiveDay() {
  const t = today();
  if (!S.days.includes(t)) { S.days.push(t); S.days = S.days.slice(-120); }
}
function streak() {
  // Gentle streak: counts back from today (or yesterday, so the morning doesn't read as "broken").
  let d = S.days.includes(today()) ? today() : addDays(today(), -1), n = 0;
  while (S.days.includes(d)) { n++; d = addDays(d, -1); }
  return n;
}
function roll() {
  // Variable-ratio schedule with a pity timer: guaranteed drop after 3 dry completions.
  const r = Math.random();
  let rar = r < 0.03 ? "legendary" : r < 0.11 ? "epic" : r < 0.28 ? "rare" : r < 0.55 ? "common" : null;
  if (!rar && S.dry >= 3) rar = "common";
  if (!rar) { S.dry++; return null; }
  S.dry = 0;
  const pool = LOOT[rar], [n, d] = pool[Math.floor(Math.random() * pool.length)];
  const it = { rar, n, d, at: Date.now() };
  S.inv.unshift(it); S.inv = S.inv.slice(0, 300);
  return it;
}
function gain(xp) {
  const before = level(S.xp).l;
  S.xp = Math.max(0, S.xp + xp);
  const after = level(S.xp).l;
  const it = xp > 0 ? roll() : null;
  if (xp > 0) markActiveDay();
  const badges = xp > 0 ? checkBadges() : [];
  save(); render();
  const q = [];
  if (after > before) q.push(["level up", `Level ${after}!`, "You're moving. Keep it gentle."]);
  if (it) q.push([it.rar, it.n, it.d]);
  badges.forEach((b) => q.push(["badge", `${b.icon} ${b.name}`, b.desc]));
  if (!q.length && xp > 0) q.push([`+${xp} xp`, "Nice.", "No drop this time. The next one might be big."]);
  toastQueue(q);
}

function complete(q, checked) {
  if (checked) logEvent({ t: "quest", id: q.id, name: q.name, g: q.g, xp: q.xp });
  else { const i = S.log.findIndex((e) => e.t === "quest" && e.id === q.id); if (i >= 0) S.log.splice(i, 1); }
  if (q.repeat !== "none" && q.due && checked) {
    q.count = (q.count || 0) + 1;
    q.due = nextOccurrence(q);
    gain(q.xp);
    return;
  }
  q.done = checked;
  q.doneAt = checked ? Date.now() : null;
  gain(checked ? q.xp : -q.xp);
}

/* ---------- activity log, stats, badges ---------- */
function logEvent(e) {
  S.log.unshift({ at: Date.now(), day: today(), ...e });
  S.log = S.log.slice(0, 3000);
}
function bestStreak() {
  const days = [...new Set(S.days)].sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
function moodByDay() {
  const m = {}; // last check-in of each day wins
  [...S.moods].sort((a, b) => a.at - b.at).forEach((x) => { m[x.day] = x; });
  return m;
}
function computeStats() {
  const quests = S.log.filter((e) => e.t === "quest");
  const byCat = {}, xpByDay = {}, countByDay = {};
  quests.forEach((e) => { byCat[e.g || "Other"] = (byCat[e.g || "Other"] || 0) + 1; countByDay[e.day] = (countByDay[e.day] || 0) + 1; });
  S.log.forEach((e) => { if (e.xp) xpByDay[e.day] = (xpByDay[e.day] || 0) + e.xp; });
  const moods = moodByDay();
  const lowDayWins = quests.filter((e) => moods[e.day] && moods[e.day].v <= MOOD_LOW).length;
  return {
    quests: quests.length, freezes: S.log.filter((e) => e.t === "freeze").length,
    moodDays: Object.keys(moods).length, lowDayWins, byCat, xpByDay, countByDay,
    bestStreak: Math.max(bestStreak(), streak()), loot: S.inv.length,
    legendary: S.inv.filter((i) => i.rar === "legendary").length, level: level(S.xp).l,
  };
}
function checkBadges() {
  const st = computeStats(), earned = [];
  for (const [id, icon, name, desc, test] of BADGES) {
    if (!S.badges[id] && test(st)) { S.badges[id] = Date.now(); earned.push({ id, icon, name, desc }); logEvent({ t: "badge", name }); }
  }
  return earned;
}

// Quests completed through the Claude connector already have their XP; roll their loot here.
function processRewards() {
  if (!S.rewards || !S.rewards.length) return;
  const items = S.rewards.splice(0);
  const q = [["claude", `${items.length} quest${items.length === 1 ? "" : "s"} completed with Claude`, items.map((r) => r.name).join(" · ")]];
  items.forEach(() => { const it = roll(); if (it) q.push([it.rar, it.n, it.d]); });
  checkBadges().forEach((b) => q.push(["badge", `${b.icon} ${b.name}`, b.desc]));
  save(); render(); toastQueue(q);
}

/* ---------- toast ---------- */
let tt;
function toast(rar, ttl, d) {
  const color = rar === "legendary" ? "legend" : rar === "badge" ? "epic" : rar in LOOT ? rar : "accent";
  const t = $("#trar"); t.textContent = rar; t.style.color = `var(--${color})`;
  $("#tttl").textContent = ttl; $("#td").textContent = d;
  const el = $("#toast"); el.classList.add("show");
  clearTimeout(tt);
  tt = setTimeout(() => el.classList.remove("show"), rar === "legendary" || rar === "epic" || rar === "badge" ? 6000 : 3500);
}
let tq = [], tqTimer;
function toastQueue(items) {
  tq.push(...items); if (tqTimer) return;
  const next = () => {
    const it = tq.shift(); if (!it) { tqTimer = null; return; }
    toast(...it);
    tqTimer = setTimeout(next, it[0] === "legendary" || it[0] === "epic" || it[0] === "badge" ? 6200 : 3700);
  };
  next();
}

/* ---------- rendering ---------- */
let view = "now";
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function questRow(q) {
  const t = today();
  const late = !q.done && q.due && q.due < t;
  const row = el("div", "q" + (q.done ? " done" : "") + (late ? " late" : ""));
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.checked = q.done; cb.setAttribute("aria-label", "Complete " + q.name);
  cb.onchange = () => complete(q, cb.checked);
  const body = el("div", "t");
  body.onclick = () => openEditor(q);
  body.append(el("div", "name", q.name));
  if (q.tiny && !q.done) body.append(el("div", "tiny", "Tiny step: " + q.tiny));
  const meta = el("div", "meta");
  if (q.due && !q.done) meta.append(el("span", "chip" + (late ? " warn" : ""), fmtDue(q)));
  if (q.repeat && q.repeat !== "none") meta.append(el("span", "chip plain", "↻ " + REPEAT_LABEL[q.repeat] + (q.count ? ` · ${q.count}×` : "")));
  if (q.g) meta.append(el("span", "chip plain", q.g));
  body.append(meta);
  row.append(cb, body, el("span", "xp", "+" + q.xp));
  return row;
}
function section(box, title, list, cls, emptyText) {
  if (!list.length && !emptyText) return;
  box.append(el("h3", cls || "", title));
  if (!list.length) box.append(el("div", "empty", emptyText));
  list.forEach((q) => box.append(questRow(q)));
}
const byTime = (a, b) => (a.due + (a.time || "99")).localeCompare(b.due + (b.time || "99"));

function render() {
  const lv = level(S.xp);
  $("#lvl").textContent = "Level " + lv.l;
  $("#xp").textContent = `${S.xp} XP · ${lv.into}/${lv.need} to next`;
  $("#bar").style.width = (lv.into / lv.need) * 100 + "%";
  const st = streak();
  $("#streak").textContent = st ? `🔥 ${st}-day streak` : "Start a streak today";
  const t = today();
  $("#today-count").textContent = S.days.includes(t) ? "You moved today ✓" : "";

  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  const box = $("#view"); box.innerHTML = "";
  const open = S.quests.filter((q) => !q.done);

  if (view === "now") {
    box.append(moodCard());
    const over = open.filter((q) => q.due && q.due < t).sort(byTime);
    const tod = open.filter((q) => q.due === t).sort(byTime);
    const anytime = open.filter((q) => !q.due);
    if (over.length) section(box, "Overdue — no guilt, just pick one", over, "overdue");
    section(box, "Today", tod, "", over.length ? "" : "Nothing scheduled today. Grab an anytime quest below.");
    section(box, "Anytime", anytime);
    if (!over.length && !tod.length && !anytime.length) box.append(el("div", "empty", "All clear. Add a quest or take Bash out."));
  } else if (view === "upcoming") {
    const up = open.filter((q) => q.due && q.due > t).sort(byTime);
    const week = up.filter((q) => daysBetween(t, q.due) <= 7);
    const later = up.filter((q) => daysBetween(t, q.due) > 7);
    section(box, "Next 7 days", week, "", "Nothing in the next week.");
    section(box, "Later", later);
  } else if (view === "all") {
    const groups = {};
    open.forEach((q) => (groups[q.g || "Other"] = groups[q.g || "Other"] || []).push(q));
    Object.keys(groups).sort().forEach((g) => section(box, g, groups[g].sort((a, b) => (a.due || "9").localeCompare(b.due || "9"))));
    const done = S.quests.filter((q) => q.done).sort((a, b) => b.doneAt - a.doneAt);
    if (done.length) section(box, `Done (${done.length})`, done.slice(0, 30));
  } else if (view === "loot") {
    const counts = {};
    S.inv.forEach((i) => { counts[i.rar] = (counts[i.rar] || 0) + 1; });
    box.append(el("h3", "", `Loot bag · ${S.inv.length} items` + (S.inv.length ? ` · ${counts.legendary || 0} legendary, ${counts.epic || 0} epic, ${counts.rare || 0} rare` : "")));
    if (!S.inv.length) box.append(el("div", "empty", "Nothing yet. Complete a quest and roll the dice."));
    const grid = el("div", "inv");
    S.inv.slice(0, 120).forEach((it) => {
      const d = el("div", "item r-" + it.rar);
      d.append(el("b", "", it.n), el("span", "", it.d));
      if (it.at) d.append(el("small", "", " " + new Date(it.at).toLocaleDateString()));
      grid.append(d);
    });
    box.append(grid);
  } else if (view === "journey") {
    renderJourney(box);
  }
  updateNotifUI();
}

/* ---------- mood check-in ---------- */
function moodCard() {
  const t = today(), todays = S.moods.filter((m) => m.day === t);
  const last = todays[todays.length - 1];
  const card = el("div", "mood-card");
  const head = el("div", "mood-head");
  head.append(el("b", "", last ? "Today's mood" : "How are you right now?"));
  if (last) head.append(el("span", "hint", `Checked in ${new Date(last.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Tap to update.`));
  else head.append(el("span", "hint", `+${MOOD_XP} XP for any honest answer.`));
  card.append(head);
  const row = el("div", "mood-row");
  MOODS.forEach((m) => {
    const b = el("button", "mood-btn" + (last && last.v === m.v ? " on" : ""), String(m.v));
    b.type = "button"; b.setAttribute("aria-label", `${m.v} out of 10, ${m.label}`); b.title = m.label;
    b.style.setProperty("--lvl", (m.v - 1) / 9);
    b.onclick = () => logMood(m.v);
    row.append(b);
  });
  card.append(row);
  const ends = el("div", "mood-ends");
  ends.append(el("span", "", "1 · can always go lower"), el("span", "now-label", last ? `${last.v} · ${MOODS[last.v - 1].label}` : ""), el("span", "", "10 · theoretical"));
  card.append(ends);
  if (last && last.v <= MOOD_LOW) {
    card.append(el("p", "mood-care", "Thanks for being honest. On days like this, one tiny quest is plenty: water, food, or a few minutes outside with Bash. If it gets heavy, call or text 988."));
  }
  return card;
}
function logMood(v) {
  const t = today(), first = !S.moods.some((m) => m.day === t);
  const note = (prompt("Anything you want to remember about today? (optional)") || "").trim().slice(0, 280);
  S.moods.push({ at: Date.now(), day: t, v, s: 10, note });
  logEvent({ t: "mood", v, s: 10, note, xp: first ? MOOD_XP : 0 });
  if (first) gain(MOOD_XP); else { const b = checkBadges(); save(); render(); toastQueue(b.map((x) => ["badge", `${x.icon} ${x.name}`, x.desc])); }
}

/* ---------- journey: stats, charts, badges, records, log ---------- */
function renderJourney(box) {
  const st = computeStats(), t = today();
  const tiles = el("div", "tiles");
  [["Quests done", st.quests], ["Best streak", st.bestStreak + (st.bestStreak === 1 ? " day" : " days")],
   ["Loot found", st.loot], ["Badges", `${Object.keys(S.badges).length}/${BADGES.length}`]]
    .forEach(([k, v]) => { const d = el("div", "tile"); d.append(el("span", "tv", String(v)), el("span", "tk", k)); tiles.append(d); });
  box.append(tiles);

  // last 14 days
  const days = []; for (let i = 13; i >= 0; i--) days.push(addDays(t, -i));
  const lbl = (d) => parseYmd(d).toLocaleDateString(undefined, { weekday: "narrow" });
  const full = (d) => parseYmd(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  box.append(el("h3", "", "XP per day · last 14 days"));
  const max = Math.max(10, ...days.map((d) => st.xpByDay[d] || 0));
  const bars = el("div", "chart bars");
  days.forEach((d) => {
    const v = st.xpByDay[d] || 0, col = el("div", "col");
    col.tabIndex = 0;
    const tip = `${full(d)}: ${v} XP, ${st.countByDay[d] || 0} quests`;
    col.title = tip; col.setAttribute("aria-label", tip); col.dataset.tip = tip;
    const bar = el("i", "bar-mark"); bar.style.height = v ? Math.max(4, (v / max) * 100) + "%" : "0";
    col.append(bar, el("span", "x" + (d === t ? " now" : ""), lbl(d)));
    bars.append(col);
  });
  box.append(bars);

  const moods = moodByDay();
  box.append(el("h3", "", "Mood · last 14 days"));
  if (!Object.keys(moods).length) box.append(el("div", "empty", "No check-ins yet. Use the mood card on the Now tab."));
  else {
    const mc = el("div", "chart moods");
    days.forEach((d) => {
      const m = moods[d], col = el("div", "col");
      col.tabIndex = 0;
      const tip = m ? `${full(d)}: ${m.v}/10 · ${MOODS[m.v - 1].label}${m.note ? " · " + m.note : ""}` : `${full(d)}: no check-in`;
      col.title = tip; col.setAttribute("aria-label", tip); col.dataset.tip = tip;
      const dot = el("i", "dot" + (m ? "" : " none")); if (m) dot.style.bottom = ((m.v - 1) / 9) * 100 + "%";
      const lane = el("div", "lane"); lane.append(dot);
      col.append(lane, el("span", "x" + (d === t ? " now" : ""), lbl(d)));
      mc.append(col);
    });
    const ax = el("div", "mood-axis"); ax.append(el("span", "", "10"), el("span", "", "5"), el("span", "", "1"));
    const wrap = el("div", "mood-wrap"); wrap.append(ax, mc); box.append(wrap);
    // mood vs activity insight
    const withQ = [], without = [];
    Object.entries(moods).forEach(([d, m]) => ((st.countByDay[d] || 0) > 0 ? withQ : without).push(m.v));
    if (withQ.length >= 3 && without.length >= 3) {
      const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
      box.append(el("p", "insight", `Average mood on days you finished a quest: ${avg(withQ)} / 10. On days you didn't: ${avg(without)} / 10.`));
    }
  }

  box.append(el("h3", "", "Badges"));
  const bg = el("div", "badges");
  BADGES.forEach(([id, icon, name, desc]) => {
    const got = S.badges[id], b = el("div", "badge" + (got ? " got" : ""));
    b.append(el("span", "bi", got ? icon : "🔒"), el("b", "", name), el("small", "", got ? `Earned ${new Date(got).toLocaleDateString()}` : desc));
    bg.append(b);
  });
  box.append(bg);

  box.append(el("h3", "", "Hall of fame · your best days"));
  const best = Object.entries(st.xpByDay).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!best.length) box.append(el("div", "empty", "Your best days will show up here. The only person on this leaderboard is you."));
  else {
    const ol = el("ol", "fame");
    best.forEach(([d, v], i) => { const li = el("li", d === t ? "now" : ""); li.append(el("span", "rk", ["🥇", "🥈", "🥉", "4", "5"][i]), el("span", "", full(d)), el("b", "", `${v} XP`)); ol.append(li); });
    box.append(ol);
  }

  if (Object.keys(st.byCat).length) {
    box.append(el("h3", "", "Quests by area"));
    const cmax = Math.max(...Object.values(st.byCat));
    const cats = el("div", "cats");
    Object.entries(st.byCat).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
      const r = el("div", "cat"); const tr = el("div", "track"); const f = el("i"); f.style.width = (n / cmax) * 100 + "%"; tr.append(f);
      r.append(el("span", "cn", c), tr, el("span", "cv", String(n))); cats.append(r);
    });
    box.append(cats);
  }

  box.append(el("h3", "", "Activity log"));
  if (!S.log.length) box.append(el("div", "empty", "Everything you do will be logged here."));
  const ul = el("ul", "log");
  let lastDay = "";
  S.log.slice(0, 60).forEach((e) => {
    if (e.day !== lastDay) { lastDay = e.day; ul.append(el("li", "log-day", e.day === t ? "Today" : full(e.day))); }
    const time = new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const text = e.t === "quest" ? `✓ ${e.name}${e.via === "claude" ? " · via Claude" : ""}` : e.t === "freeze" ? "🧊 Broke the freeze" : e.t === "badge" ? `🏅 Badge: ${e.name}`
      : e.t === "mood" ? `◐ Mood ${e.v}/10 · ${MOODS[e.v - 1].label}${e.note ? " · " + e.note : ""}` : e.t;
    const li = el("li"); li.append(el("span", "lt", time), el("span", "lx", text)); if (e.xp) li.append(el("span", "xp", "+" + e.xp));
    ul.append(li);
  });
  box.append(ul);
}

// shared tooltip for chart columns (hover, focus or tap)
const chartTip = document.createElement("div"); chartTip.className = "chart-tip"; chartTip.hidden = true; document.body.append(chartTip);
function showTip(e) {
  const c = e.target.closest && e.target.closest(".chart .col"); if (!c) return;
  const r = c.getBoundingClientRect();
  chartTip.textContent = c.dataset.tip; chartTip.hidden = false;
  chartTip.style.left = Math.min(Math.max(r.left + r.width / 2, 130), innerWidth - 130) + "px";
  chartTip.style.top = r.top - 6 + "px";
}
const hideTip = () => (chartTip.hidden = true);
document.addEventListener("pointerover", showTip);
document.addEventListener("focusin", showTip);
document.addEventListener("pointerout", (e) => { if (e.target.closest && e.target.closest(".chart .col")) hideTip(); });
document.addEventListener("scroll", hideTip, { passive: true });

/* ---------- editor ---------- */
let editing = null;
function openEditor(q) {
  editing = q || null;
  const f = $("#editForm");
  $("#edTitle").textContent = q ? "Edit quest" : "New quest";
  f.name.value = q ? q.name : "";
  f.tiny.value = q ? q.tiny : "";
  f.g.value = q ? q.g : "";
  f.xp.value = String(q ? q.xp : 15);
  f.due.value = q ? q.due : "";
  f.time.value = q ? q.time : "";
  f.repeat.value = q ? q.repeat : "none";
  f.remind.value = String(q ? q.remind ?? 0 : 0);
  $("#edDelete").hidden = !q;
  $("#edIcs").hidden = !(q && q.due);
  const cats = [...new Set(S.quests.map((x) => x.g).filter(Boolean))];
  $("#cats").innerHTML = cats.map((c) => `<option value="${c.replace(/"/g, "&quot;")}">`).join("");
  $("#editor").showModal();
  setTimeout(() => f.name.focus(), 50);
}
$("#editor").addEventListener("close", () => {
  if ($("#editor").returnValue !== "save") return;
  const f = $("#editForm");
  const name = f.name.value.trim();
  if (!name) return;
  let due = f.due.value;
  const repeat = f.repeat.value;
  if (repeat !== "none" && !due) due = today(); // repeating quests need a start date
  const data = { name, tiny: f.tiny.value.trim(), g: f.g.value.trim() || "My quests", xp: Number(f.xp.value),
    due, time: f.time.value, repeat, remind: Number(f.remind.value) };
  if (editing) Object.assign(editing, data);
  else S.quests.push({ id: S.nextId++, ...data, done: false, doneAt: null, count: 0 });
  save(); render();
  if (data.due && data.remind >= 0) updateNotifUI();
});
$("#edDelete").onclick = () => {
  if (!editing || !confirm(`Delete "${editing.name}"?`)) return;
  S.quests = S.quests.filter((q) => q !== editing);
  save(); $("#editor").close(); render();
};
$("#edIcs").onclick = () => editing && downloadIcs([editing], slug(editing.name) + ".ics");

/* ---------- reminders ---------- */
const hasNotif = "Notification" in window;
function fireTime(q) {
  if (!q.due || q.done || q.remind == null || q.remind < 0) return null;
  const [h, m] = (q.time || "09:00").split(":").map(Number);
  const d = parseYmd(q.due); d.setHours(h, m, 0, 0);
  return { at: d.getTime() - q.remind * 60000, dueAt: d.getTime() };
}
function loadNotified() { try { return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}"); } catch (e) { return {}; } }
async function checkReminders() {
  if (!hasNotif || Notification.permission !== "granted") return;
  if (SYNC.code && SYNC.push) return; // the server sends these
  const now = Date.now(), sent = loadNotified();
  for (const q of S.quests) {
    const f = fireTime(q);
    if (!f || now < f.at || now > f.dueAt + 6 * 3600000) continue;
    const key = `${q.id}@${q.due}`;
    if (sent[key]) continue;
    sent[key] = now;
    const body = q.tiny ? "Tiny step: " + q.tiny : `+${q.xp} XP waiting`;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(q.name, { body, tag: key, icon: "icons/icon-192.png", badge: "icons/icon-192.png" });
      else new Notification(q.name, { body, tag: key });
    } catch (e) {}
  }
  // forget old entries
  for (const k in sent) if (now - sent[k] > 14 * 86400000) delete sent[k];
  try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(sent)); } catch (e) {}
}
async function enableNotifications() {
  if (!hasNotif) { alert("This browser doesn't support notifications. Use 'Send to my phone's calendar' in Settings instead."); return; }
  const p = await Notification.requestPermission();
  updateNotifUI();
  if (p === "granted") {
    if (SYNC.code) await subscribePush();
    toast("reminders", "Reminders on", SYNC.push ? "Push reminders will reach you even when the app is closed." : "You'll get a nudge while the app is open.");
    checkReminders();
  }
}
function updateNotifUI() {
  const p = hasNotif ? Notification.permission : "unsupported";
  const anyScheduled = S.quests.some((q) => q.due && !q.done && q.remind >= 0);
  $("#notifBanner").hidden = !(p === "default" && anyScheduled);
  $("#notifStatus").textContent = p === "granted" ? "On. For reminders when the app is fully closed, also export to your calendar."
    : p === "denied" ? "Blocked in your browser settings. Use calendar export instead."
    : p === "unsupported" ? "Not supported here. Use calendar export instead." : "Off.";
  $("#notifBtn2").hidden = p !== "default";
  updateSyncUI();
}
$("#enableNotif").onclick = enableNotifications;
$("#notifBtn2").onclick = enableNotifications;

/* ---------- calendar export (.ics with alarms) ---------- */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "quest";
const icsEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
function icsFold(line) { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = " " + line.slice(74); } out.push(line); return out.join("\r\n"); }
function downloadIcs(quests, filename) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const RR = { daily: "FREQ=DAILY", weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", weekly: "FREQ=WEEKLY", monthly: "FREQ=MONTHLY" };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Quest Log//EN", "CALSCALE:GREGORIAN"];
  quests.filter((q) => q.due && !q.done).forEach((q) => {
    const d = q.due.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:quest-${q.id}-${d}@questlog`, `DTSTAMP:${stamp}`);
    if (q.time) {
      const t = q.time.replace(":", "") + "00";
      const [h, m] = q.time.split(":").map(Number);
      const end = new Date(2000, 0, 1, h, m + 30);
      lines.push(`DTSTART:${d}T${t}`, `DTEND:${d}T${pad(end.getHours())}${pad(end.getMinutes())}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${addDays(q.due, 1).replace(/-/g, "")}`);
    }
    lines.push(`SUMMARY:${icsEsc("⚔ " + q.name)}`);
    lines.push(`DESCRIPTION:${icsEsc((q.tiny ? "Tiny step: " + q.tiny + "\n" : "") + `+${q.xp} XP in Quest Log`)}`);
    if (RR[q.repeat]) lines.push("RRULE:" + RR[q.repeat]);
    if (q.remind >= 0) {
      // all-day events: alarm relative to midnight, so shift to 9am
      const mins = q.time ? q.remind : q.remind - 540;
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(q.name)}`,
        mins === 0 ? "TRIGGER:PT0M" : mins > 0 ? `TRIGGER:-PT${mins}M` : `TRIGGER:PT${-mins}M`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  download(lines.map(icsFold).join("\r\n"), filename, "text/calendar");
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- settings ---------- */
function applyTheme() {
  if (S.theme) document.documentElement.dataset.theme = S.theme; else delete document.documentElement.dataset.theme;
  $("#themeSel").value = S.theme || "";
}
$("#settingsBtn").onclick = () => { updateNotifUI(); $("#settings").showModal(); };
$("#themeSel").onchange = (e) => { S.theme = e.target.value; save(); applyTheme(); };
$("#icsAll").onclick = () => {
  const qs = S.quests.filter((q) => q.due && !q.done);
  if (!qs.length) return toast("calendar", "Nothing scheduled", "Give a quest a date first.");
  downloadIcs(qs, "quest-log.ics");
};
$("#exportBtn").onclick = () => download(JSON.stringify(S, null, 2), `quest-log-backup-${today()}.json`, "application/json");
$("#importFile").onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.quests)) throw new Error("bad file");
    if (!confirm("Replace your current quests, XP and loot with this backup?")) return;
    S = data; upgrade();
    S.quests.forEach((q) => { q.due = q.due || ""; q.time = q.time || ""; q.repeat = q.repeat || "none"; q.remind = q.remind ?? 0; });
    S.nextId = Math.max(S.nextId || 1, ...S.quests.map((q) => q.id + 1));
    save(); pushState(true); applyTheme(); render(); toast("restored", "Backup loaded", `${S.quests.length} quests, ${S.xp} XP.`);
  } catch (err) { alert("That file couldn't be read as a Quest Log backup."); }
  e.target.value = "";
};
$("#resetBtn").onclick = () => {
  if (confirm("Reset all quests, XP and loot? Consider exporting a backup first.")) { S = fresh(); save(); applyTheme(); render(); $("#settings").close(); }
};


/* ---------- sync + push (Cloudflare Worker backend) ---------- */
const SYNC_KEY = "quest-log-sync";
let SYNC = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } })();
function saveSync() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(SYNC)); } catch (e) {} writeSwConfig(); }
const onServer = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
let syncTimer, syncState = "";

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "content-type": "application/json", Authorization: "Bearer " + SYNC.code, ...(opts.headers || {}) } });
  return res;
}
function scheduleSync() { if (!SYNC.code) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => pushState(), 1200); }
async function pushState(force = false) {
  if (!SYNC.code) return;
  try {
    const res = await apiFetch("/api/state", { method: "PUT", body: JSON.stringify({ state: S, updatedAt: S.updatedAt || Date.now(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, force }) });
    if (res.status === 409) return pullState();
    setSyncState(res.ok ? "synced" : "error");
  } catch (e) { setSyncState("offline"); }
}
async function pullState() {
  if (!SYNC.code) return;
  try {
    const res = await apiFetch("/api/state");
    if (res.status === 404) return pushState(true); // first device: upload
    if (!res.ok) return setSyncState("error");
    const remote = await res.json();
    if ((remote.updatedAt || 0) > (S.updatedAt || 0)) {
      S = remote.state; upgrade(); S.updatedAt = remote.updatedAt;
      saveLocal(); applyTheme(); render(); processRewards();
    } else if ((remote.updatedAt || 0) < (S.updatedAt || 0)) {
      await pushState();
    }
    setSyncState("synced");
  } catch (e) { setSyncState("offline"); }
}
function setSyncState(s) { syncState = s; updateSyncUI(); }

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function writeSwConfig() {
  try { const c = await caches.open("quest-log-config"); await c.put("/__config", new Response(JSON.stringify({ code: SYNC.code || "" }))); } catch (e) {}
}
function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
async function subscribePush() {
  if (!SYNC.code || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { vapidPublicKey } = await (await fetch("/api/config")).json();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(vapidPublicKey) });
    const res = await apiFetch("/api/subscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
    SYNC.push = res.ok; saveSync(); updateSyncUI();
    return res.ok;
  } catch (e) { console.warn(e); SYNC.push = false; saveSync(); updateSyncUI(); return false; }
}
async function unsubscribePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await apiFetch("/api/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
  } catch (e) {}
  SYNC.push = false;
}
async function startSync(code) {
  SYNC = { code, push: false }; saveSync();
  await pullState();
  if (hasNotif && Notification.permission === "granted") await subscribePush();
  updateSyncUI();
}
function updateSyncUI() {
  const box = $("#syncBox"); if (!box) return;
  box.hidden = !onServer;
  const on = !!SYNC.code;
  $("#syncStatus").textContent = !on ? "Off. Turn on to sync devices and get push reminders when the app is closed."
    : `On${syncState ? " · " + syncState : ""}. Push reminders: ${SYNC.push ? "on" : hasNotif && Notification.permission === "granted" ? "not set up" : "turn on reminders above"}.`;
  $("#syncOn").hidden = on; $("#syncLink").hidden = on;
  $("#syncShow").hidden = !on; $("#syncTest").hidden = !(on && SYNC.push); $("#syncOff").hidden = !on;
}
$("#syncOn").onclick = async () => { await startSync(newCode()); toast("sync", "Sync is on", "Use 'Show sync code' to link another device."); };
$("#syncLink").onclick = async () => {
  const code = (prompt("Paste the sync code from your other device:") || "").trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) { if (code) alert("That doesn't look like a sync code."); return; }
  S.updatedAt = 0; // let the server copy win
  await startSync(code); toast("sync", "Linked", "This device now shares your quests.");
};
$("#syncShow").onclick = async () => {
  try { await navigator.clipboard.writeText(SYNC.code); toast("sync", "Code copied", "Paste it into Quest Log on your other device. Keep it private."); }
  catch (e) { prompt("Your sync code (keep it private):", SYNC.code); }
};
$("#syncTest").onclick = async () => {
  const res = await apiFetch("/api/test-push", { method: "POST" });
  const r = res.ok ? await res.json() : null;
  toast("push", r && r.sent ? "Test sent" : "Test failed", r && r.sent ? "A notification should appear in a few seconds." : "Try turning reminders off and on again.");
};
$("#syncOff").onclick = async () => {
  if (!confirm("Turn off sync on this device? Your quests stay here and on the server.")) return;
  await unsubscribePush(); SYNC = {}; saveSync(); updateSyncUI();
};
document.addEventListener("visibilitychange", () => { if (!document.hidden) pullState(); });

/* ---------- wiring ---------- */
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { view = b.dataset.view; render(); }));
$("#addBtn").onclick = () => openEditor(null);
$("#freeze").onclick = () => { logEvent({ t: "freeze", xp: 5 }); gain(5); };
document.addEventListener("visibilitychange", () => { if (!document.hidden) { render(); checkReminders(); } });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

load(); applyTheme(); render(); processRewards();
writeSwConfig(); pullState();
checkReminders();
setInterval(checkReminders, 30000);
// re-render at midnight so "Today" rolls over
setInterval(() => { if (S._lastDay !== today()) { S._lastDay = today(); render(); } }, 60000);
