// Quest Log MCP server (Streamable HTTP, stateless JSON-RPC).
// Lets Claude read and change your quests, log mood and summarize progress.
// Called only after OAuth succeeds; ctx.props.userId identifies the user.

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER_INFO = { name: "quest-log", title: "Quest Log", version: "1.0.0" };
const XP_VALUES = [5, 10, 15, 20, 25, 30, 50];
const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"];
const MOOD_WORDS = ["Bottom", "Awful", "Rough", "Low", "Meh", "Okay", "Decent", "Good", "Great", "Peak"];
const MOOD_XP = 5;

const INSTRUCTIONS = `Quest Log is the user's gamified, ADHD-friendly task tracker. Quests have a name, a "tiny step" (the smallest way to start when frozen), a category, XP, and optional schedule (due date, time, repeat, reminder).
Guidelines: keep quest names short and concrete; always include a tiny step; prefer small quests over big ones; when the user mentions something they finished, offer to mark it complete; mood is a 1-10 scale where 1 and 10 are bookends rarely used. Completing a quest here records it, and loot drops when the user next opens the app.`;

/* ---------------- tools ---------------- */

const questInput = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short, concrete quest name.", maxLength: 120 },
    tiny: { type: "string", description: "Tiny first step for when the user feels frozen.", maxLength: 160 },
    category: { type: "string", description: "e.g. Health & safety net, Bash, Career, Money, Next home, House, Art, Strength, Programming.", maxLength: 40 },
    xp: { type: "integer", enum: XP_VALUES, description: "Reward size. Default 15." },
    due: { type: "string", description: "Due date YYYY-MM-DD in the user's time zone. Omit for 'anytime'." },
    time: { type: "string", description: "Due time HH:MM (24h). Optional." },
    repeat: { type: "string", enum: REPEATS, description: "Default none. Repeating quests need a due date (defaults to today)." },
    remind: { type: "integer", enum: [-1, 0, 15, 60, 1440], description: "Minutes before due to remind; -1 = no reminder. Default 0." },
    done: { type: "boolean", description: "Set true to log something the user already finished (counts toward XP and loot)." },
  },
  required: ["name"],
};

const TOOLS = [
  {
    name: "list_quests",
    title: "List quests",
    description: "List the user's quests. Views: 'now' (overdue, today, anytime), 'upcoming', 'all' (every open quest), 'done' (recently completed).",
    inputSchema: { type: "object", properties: { view: { type: "string", enum: ["now", "upcoming", "all", "done"], description: "Default 'now'." } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_quests",
    title: "Add quests",
    description: "Add one or more quests. Use done:true to record things the user already did today.",
    inputSchema: { type: "object", properties: { quests: { type: "array", items: questInput, minItems: 1, maxItems: 25 } }, required: ["quests"] },
  },
  {
    name: "complete_quest",
    title: "Complete quest",
    description: "Mark a quest complete by id. Repeating quests roll forward to their next date. XP is added now; the loot roll happens when the user next opens the app.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
  },
  {
    name: "update_quest",
    title: "Update quest",
    description: "Change a quest's fields (rename, reschedule, change tiny step, etc.). Pass due:'' to make it 'anytime'.",
    inputSchema: { type: "object", properties: { id: { type: "integer" }, ...questInput.properties }, required: ["id"] },
  },
  {
    name: "delete_quest",
    title: "Delete quest",
    description: "Permanently delete a quest by id. Confirm with the user first.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    annotations: { destructiveHint: true },
  },
  {
    name: "log_mood",
    title: "Log mood",
    description: "Record a mood check-in on the 1-10 scale, with an optional short note. Only log a number the user actually gave.",
    inputSchema: { type: "object", properties: { value: { type: "integer", minimum: 1, maximum: 10 }, note: { type: "string", maxLength: 280 } }, required: ["value"] },
  },
  {
    name: "get_summary",
    title: "Get progress summary",
    description: "Level, XP, streak, badges, quests completed and mood check-ins (with notes) over the last N days. Use it to see how the user's week is actually going.",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 60, description: "Default 7." } } },
    annotations: { readOnlyHint: true },
  },
];

/* ---------------- HTTP / JSON-RPC ---------------- */

export async function handleMcp(request, env, ctx) {
  if (request.method === "GET") return new Response("This MCP server does not offer an SSE stream.", { status: 405, headers: { Allow: "POST" } });
  if (request.method === "DELETE") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });

  let msg;
  try { msg = await request.json(); } catch { return rpcError(null, -32700, "Parse error"); }
  if (Array.isArray(msg)) return rpcError(null, -32600, "Batch requests are not supported");
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id ?? null, -32600, "Invalid request");

  // notifications and responses: acknowledge
  if (msg.id === undefined || msg.id === null) return new Response(null, { status: 202 });

  const userId = ctx.props?.userId;
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        return rpcResult(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case "ping": return rpcResult(msg.id, {});
      case "tools/list": return rpcResult(msg.id, { tools: TOOLS });
      case "tools/call": {
        const { name, arguments: args = {} } = msg.params || {};
        if (!TOOLS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
        try {
          const text = await callTool(env, userId, name, args);
          return rpcResult(msg.id, { content: [{ type: "text", text }] });
        } catch (e) {
          if (e instanceof ToolError) return rpcResult(msg.id, { content: [{ type: "text", text: e.message }], isError: true });
          throw e;
        }
      }
      case "resources/list": return rpcResult(msg.id, { resources: [] });
      case "prompts/list": return rpcResult(msg.id, { prompts: [] });
      default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    console.error(e);
    return rpcError(msg.id, -32603, "Internal error");
  }
}

const jsonResponse = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const rpcResult = (id, result) => jsonResponse({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
class ToolError extends Error {}

/* ---------------- state access ---------------- */

async function loadUser(env, userId) {
  const row = await env.DB.prepare("SELECT state, tz FROM users WHERE id = ?").bind(userId).first();
  if (!row) throw new ToolError("No Quest Log data found. Open the app, turn on sync in Settings, then reconnect.");
  const S = JSON.parse(row.state);
  S.quests = S.quests || []; S.log = S.log || []; S.moods = S.moods || []; S.days = S.days || []; S.badges = S.badges || {}; S.inv = S.inv || [];
  S.nextId = Math.max(S.nextId || 1, ...S.quests.map((q) => q.id + 1));
  return { S, tz: row.tz || "America/Chicago" };
}
async function saveUser(env, userId, S, tz) {
  S.updatedAt = Date.now();
  await env.DB.prepare("UPDATE users SET state = ?, updated_at = ?, tz = ? WHERE id = ?")
    .bind(JSON.stringify(S), S.updatedAt, tz, userId).run();
}

/* ---------------- date helpers (user's time zone) ---------------- */

function todayIn(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
function advance(s, repeat) {
  const d = parse(s);
  if (repeat === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (repeat === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (repeat === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (repeat === "weekdays") { do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6); }
  return ymd(d);
}
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s));
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function level(xp) { let l = 1, need = 50, acc = 0; while (xp >= acc + need) { acc += need; l++; need = Math.round(need * 1.25); } return { l, into: xp - acc, need }; }
function streak(days, t) {
  let d = days.includes(t) ? t : addDays(t, -1), n = 0;
  while (days.includes(d)) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------------- tool implementations ---------------- */

function describe(q, t) {
  const bits = [`#${q.id} ${q.name}`];
  if (q.done) bits.push("(done)");
  if (q.due) bits.push(`due ${q.due}${q.time ? " " + q.time : ""}${q.due < t && !q.done ? " OVERDUE" : ""}`); else if (!q.done) bits.push("anytime");
  if (q.repeat && q.repeat !== "none") bits.push(`repeats ${q.repeat}`);
  bits.push(`[${q.g || "Other"}] +${q.xp}xp`);
  if (q.tiny && !q.done) bits.push(`tiny step: ${q.tiny}`);
  return bits.join(" · ");
}

function cleanFields(a, t, partial) {
  const out = {};
  if (a.name !== undefined) { const n = String(a.name).trim().slice(0, 120); if (!n) throw new ToolError("Quest name can't be empty."); out.name = n; }
  if (a.tiny !== undefined) out.tiny = String(a.tiny).trim().slice(0, 160);
  if (a.category !== undefined) out.g = String(a.category).trim().slice(0, 40) || "My quests";
  if (a.xp !== undefined) { if (!XP_VALUES.includes(a.xp)) throw new ToolError(`xp must be one of ${XP_VALUES.join(", ")}.`); out.xp = a.xp; }
  if (a.due !== undefined) { if (a.due && !validDate(a.due)) throw new ToolError("due must be YYYY-MM-DD."); out.due = a.due || ""; }
  if (a.time !== undefined) { if (a.time && !validTime(a.time)) throw new ToolError("time must be HH:MM (24h)."); out.time = a.time || ""; }
  if (a.repeat !== undefined) { if (!REPEATS.includes(a.repeat)) throw new ToolError(`repeat must be one of ${REPEATS.join(", ")}.`); out.repeat = a.repeat; }
  if (a.remind !== undefined) out.remind = Number(a.remind);
  if (!partial) {
    out.tiny ??= ""; out.g ??= "My quests"; out.xp ??= 15; out.due ??= ""; out.time ??= ""; out.repeat ??= "none"; out.remind ??= 0;
  }
  return out;
}

function completeQuest(S, q, t) {
  S.log.unshift({ t: "quest", id: q.id, name: q.name, g: q.g, xp: q.xp, at: Date.now(), day: t, via: "claude" });
  S.xp = (S.xp || 0) + q.xp;
  if (!S.days.includes(t)) { S.days.push(t); S.days = S.days.slice(-120); }
  (S.rewards = S.rewards || []).push({ name: q.name, xp: q.xp, at: Date.now() }); // app rolls loot + badges on next open
  if (q.repeat && q.repeat !== "none" && q.due) {
    q.count = (q.count || 0) + 1;
    let d = advance(q.due, q.repeat); while (d <= t) d = advance(d, q.repeat);
    q.due = d;
    return `Completed "${q.name}" (+${q.xp} XP). Next one is ${q.due}.`;
  }
  q.done = true; q.doneAt = Date.now();
  return `Completed "${q.name}" (+${q.xp} XP).`;
}

async function callTool(env, userId, name, a) {
  const { S, tz } = await loadUser(env, userId);
  const t = todayIn(tz);
  const find = (id) => { const q = S.quests.find((x) => x.id === Number(id)); if (!q) throw new ToolError(`No quest with id ${id}. Use list_quests to see ids.`); return q; };

  switch (name) {
    case "list_quests": {
      const view = a.view || "now";
      const open = S.quests.filter((q) => !q.done);
      const byDue = (x, y) => (x.due + (x.time || "99")).localeCompare(y.due + (y.time || "99"));
      let lines = [];
      if (view === "now") {
        const over = open.filter((q) => q.due && q.due < t).sort(byDue), tod = open.filter((q) => q.due === t).sort(byDue), any = open.filter((q) => !q.due);
        if (over.length) lines.push("Overdue:", ...over.map((q) => "  " + describe(q, t)));
        lines.push("Today:", ...(tod.length ? tod.map((q) => "  " + describe(q, t)) : ["  (nothing scheduled)"]));
        if (any.length) lines.push("Anytime:", ...any.map((q) => "  " + describe(q, t)));
      } else if (view === "upcoming") {
        lines = open.filter((q) => q.due && q.due > t).sort(byDue).map((q) => describe(q, t));
      } else if (view === "all") {
        lines = open.sort((x, y) => (x.g || "").localeCompare(y.g || "") || (x.due || "9").localeCompare(y.due || "9")).map((q) => describe(q, t));
      } else {
        lines = S.log.filter((e) => e.t === "quest").slice(0, 30).map((e) => `${e.day} · ${e.name} · +${e.xp}xp${e.via === "claude" ? " (via Claude)" : ""}`);
      }
      return `Today is ${t} (${tz}).\n` + (lines.length ? lines.join("\n") : "Nothing here.");
    }

    case "add_quests": {
      const added = [];
      for (const raw of a.quests || []) {
        const f = cleanFields(raw, t, false);
        if (f.repeat !== "none" && !f.due) f.due = t;
        const q = { id: S.nextId++, ...f, done: false, doneAt: null, count: 0 };
        S.quests.push(q);
        added.push(raw.done ? completeQuest(S, q, t) : `Added ${describe(q, t)}`);
      }
      await saveUser(env, userId, S, tz);
      return added.join("\n");
    }

    case "complete_quest": {
      const q = find(a.id);
      if (q.done) return `"${q.name}" is already done.`;
      const msg = completeQuest(S, q, t);
      await saveUser(env, userId, S, tz);
      return msg + " Loot rolls when the user opens Quest Log.";
    }

    case "update_quest": {
      const q = find(a.id);
      const { id, ...rest } = a;
      Object.assign(q, cleanFields(rest, t, true));
      if (q.repeat !== "none" && !q.due) q.due = t;
      await saveUser(env, userId, S, tz);
      return `Updated ${describe(q, t)}`;
    }

    case "delete_quest": {
      const q = find(a.id);
      S.quests = S.quests.filter((x) => x !== q);
      await saveUser(env, userId, S, tz);
      return `Deleted "${q.name}".`;
    }

    case "log_mood": {
      const v = Number(a.value);
      if (!(v >= 1 && v <= 10 && Number.isInteger(v))) throw new ToolError("value must be an integer from 1 to 10.");
      const note = String(a.note || "").trim().slice(0, 280);
      const first = !S.moods.some((m) => m.day === t);
      S.moods.push({ at: Date.now(), day: t, v, s: 10, note, via: "claude" });
      S.log.unshift({ t: "mood", v, s: 10, note, xp: first ? MOOD_XP : 0, at: Date.now(), day: t, via: "claude" });
      if (first) {
        S.xp = (S.xp || 0) + MOOD_XP;
        if (!S.days.includes(t)) S.days.push(t);
        (S.rewards = S.rewards || []).push({ name: "Mood check-in", xp: MOOD_XP, at: Date.now() });
      }
      await saveUser(env, userId, S, tz);
      return `Logged mood ${v}/10 (${MOOD_WORDS[v - 1]})${note ? `: "${note}"` : ""}.${first ? ` +${MOOD_XP} XP.` : ""}`;
    }

    case "get_summary": {
      const days = Math.min(60, Math.max(1, Number(a.days) || 7));
      const since = addDays(t, -(days - 1));
      const recent = S.log.filter((e) => e.day >= since);
      const quests = recent.filter((e) => e.t === "quest");
      const xp = recent.reduce((s, e) => s + (e.xp || 0), 0);
      const lv = level(S.xp || 0);
      const perDay = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = addDays(t, -i);
        const q = quests.filter((e) => e.day === d).length;
        const moods = S.moods.filter((m) => m.day === d);
        const m = moods[moods.length - 1];
        perDay.push(`  ${d}: ${q} quest${q === 1 ? "" : "s"}${m ? ` · mood ${m.v}/10${m.note ? ` ("${m.note}")` : ""}` : ""}`);
      }
      const byCat = {};
      quests.forEach((e) => { byCat[e.g || "Other"] = (byCat[e.g || "Other"] || 0) + 1; });
      const open = S.quests.filter((q) => !q.done);
      return [
        `Today is ${t}. Last ${days} days:`,
        `Level ${lv.l} (${S.xp || 0} XP total, ${lv.into}/${lv.need} to next) · current streak ${streak(S.days, t)} day${streak(S.days, t) === 1 ? "" : "s"}`,
        `${quests.length} quests completed, ${xp} XP earned` + (Object.keys(byCat).length ? ` · by area: ${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""),
        `Open quests: ${open.length} (${open.filter((q) => q.due && q.due < t).length} overdue)`,
        `Badges earned: ${Object.keys(S.badges).length}`,
        "Per day:", ...perDay,
      ].join("\n");
    }
  }
  throw new ToolError(`Unknown tool ${name}`);
}
