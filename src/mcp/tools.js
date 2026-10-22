// MCP tool definitions and implementations. Game rules come from the shared core, so a quest
// completed through Claude earns exactly what it would in the app.
import { addDays, localYmd, REPEATS } from "../../public/js/core/dates.js";
import {
  ValidationError,
  byDueTime,
  cleanQuestFields,
  nowView,
  REMIND_OPTIONS,
  rollMissed,
  upcoming,
} from "../../public/js/core/quests.js";
import {
  XP_VALUES,
  completeQuest,
  level,
  moodLabel,
  queueReward,
  recordMood,
  streak,
} from "../../public/js/core/rules.js";
import { upgradeState } from "../../public/js/core/state.js";
import { getUser, putUser } from "../db.js";

/** A problem the model can fix (bad id, bad input). Returned as an isError tool result, not a protocol error. */
export class ToolError extends Error {}

const MAX_BATCH = 25;
const MAX_SUMMARY_DAYS = 60;

const questInput = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short, concrete quest name.", maxLength: 120 },
    tiny: { type: "string", description: "Tiny first step for when the user feels frozen.", maxLength: 160 },
    category: {
      type: "string",
      description: "e.g. Health & safety net, Bash, Career, Money, Next home, House, Art, Strength, Programming.",
      maxLength: 40,
    },
    xp: { type: "integer", enum: XP_VALUES, description: "Reward size. Default 15." },
    due: { type: "string", description: "Due date YYYY-MM-DD in the user's time zone. Omit for 'anytime'." },
    time: { type: "string", description: "Due time HH:MM (24h). Optional." },
    repeat: {
      type: "string",
      enum: REPEATS,
      description: "Default none. Repeating quests need a due date (defaults to today).",
    },
    remind: {
      type: "integer",
      enum: REMIND_OPTIONS,
      description: "Minutes before due to remind; -1 = no reminder. Default 0.",
    },
    done: {
      type: "boolean",
      description: "Set true to log something the user already finished (counts toward XP and loot).",
    },
  },
  required: ["name"],
};

const idInput = { type: "object", properties: { id: { type: "integer" } }, required: ["id"] };

export const TOOLS = [
  {
    name: "list_quests",
    title: "List quests",
    description:
      "List the user's quests. Views: 'now' (overdue, today, anytime), 'upcoming', 'all' (every open quest), 'done' (recently completed).",
    inputSchema: {
      type: "object",
      properties: { view: { type: "string", enum: ["now", "upcoming", "all", "done"], description: "Default 'now'." } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_quests",
    title: "Add quests",
    description: "Add one or more quests. Use done:true to record things the user already did today.",
    inputSchema: {
      type: "object",
      properties: { quests: { type: "array", items: questInput, minItems: 1, maxItems: MAX_BATCH } },
      required: ["quests"],
    },
  },
  {
    name: "complete_quest",
    title: "Complete quest",
    description:
      "Mark a quest complete by id. Repeating quests roll forward to their next date. XP is added now; the loot roll happens when the user next opens the app.",
    inputSchema: idInput,
  },
  {
    name: "update_quest",
    title: "Update quest",
    description:
      "Change a quest's fields (rename, reschedule, change tiny step, etc.). Pass due:'' to make it 'anytime'.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" }, ...questInput.properties },
      required: ["id"],
    },
  },
  {
    name: "delete_quest",
    title: "Delete quest",
    description: "Permanently delete a quest by id. Confirm with the user first.",
    inputSchema: idInput,
    annotations: { destructiveHint: true },
  },
  {
    name: "log_mood",
    title: "Log mood",
    description:
      "Record a mood check-in on the 1-10 scale, with an optional short note. Only log a number the user actually gave.",
    inputSchema: {
      type: "object",
      properties: { value: { type: "integer", minimum: 1, maximum: 10 }, note: { type: "string", maxLength: 280 } },
      required: ["value"],
    },
  },
  {
    name: "get_summary",
    title: "Get progress summary",
    description:
      "Level, XP, streak, badges, quests completed and mood check-ins (with notes) over the last N days. Use it to see how the user's week is actually going.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: MAX_SUMMARY_DAYS, description: "Default 7." } },
    },
    annotations: { readOnlyHint: true },
  },
];

/* ---------- formatting ---------- */

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One quest as a single line the model can read and refer back to by id. */
export function describe(q, today) {
  const bits = [`#${q.id} ${q.name}`];
  if (q.done) bits.push("(done)");
  if (q.due) bits.push(`due ${q.due}${q.time ? " " + q.time : ""}${q.due < today && !q.done ? " OVERDUE" : ""}`);
  else if (!q.done) bits.push("anytime");
  if (q.repeat && q.repeat !== "none") bits.push(`repeats ${q.repeat}`);
  bits.push(`[${q.g || "Other"}] +${q.xp}xp`);
  if (q.tiny && !q.done) bits.push(`tiny step: ${q.tiny}`);
  return bits.join(" · ");
}

const indent = (lines) => lines.map((l) => "  " + l);

/* ---------- tool implementations ---------- */
// Each takes (ctx, args) and returns text. ctx = { S, t, tz, now, save }.

function cleanOrThrow(args, opts) {
  try {
    return cleanQuestFields(args, opts);
  } catch (e) {
    if (e instanceof ValidationError) throw new ToolError(e.message);
    throw e;
  }
}

function findQuest(S, id) {
  const q = S.quests.find((x) => x.id === Number(id));
  if (!q) throw new ToolError(`No quest with id ${id}. Use list_quests to see ids.`);
  return q;
}

/** Completes a quest the Claude way: XP now, loot when the app next opens. */
function completeViaClaude(ctx, q) {
  const { nextDue } = completeQuest(ctx.S, q, { today: ctx.t, now: ctx.now, via: "claude" });
  queueReward(ctx.S, q.name, q.xp, ctx.now);
  return `Completed "${q.name}" (+${q.xp} XP).${nextDue ? ` Next one is ${nextDue}.` : ""}`;
}

const impl = {
  list_quests({ S, t, tz }, a) {
    const view = a.view || "now";
    const line = (q) => describe(q, t);
    let lines = [];
    if (view === "now") {
      const v = nowView(S.quests, t);
      if (v.overdue.length) lines.push("Overdue:", ...indent(v.overdue.map(line)));
      lines.push("Today:", ...(v.today.length ? indent(v.today.map(line)) : ["  (nothing scheduled)"]));
      if (v.anytime.length) lines.push("Anytime:", ...indent(v.anytime.map(line)));
    } else if (view === "upcoming") {
      lines = upcoming(S.quests, t).map(line);
    } else if (view === "all") {
      lines = S.quests
        .filter((q) => !q.done)
        .sort(
          (x, y) =>
            (x.g || "").localeCompare(y.g || "") || (x.due || "9").localeCompare(y.due || "9") || byDueTime(x, y),
        )
        .map(line);
    } else {
      lines = S.log
        .filter((e) => e.t === "quest")
        .slice(0, 30)
        .map((e) => `${e.day} · ${e.name} · +${e.xp}xp${e.via === "claude" ? " (via Claude)" : ""}`);
    }
    return `Today is ${t} (${tz}).\n` + (lines.length ? lines.join("\n") : "Nothing here.");
  },

  async add_quests(ctx, a) {
    if (!Array.isArray(a.quests) || !a.quests.length) throw new ToolError("quests must be a non-empty array.");
    if (a.quests.length > MAX_BATCH) throw new ToolError(`Add at most ${MAX_BATCH} quests at a time.`);
    const fields = a.quests.map((raw) => cleanOrThrow(raw)); // validate all before changing anything
    const out = fields.map((f, i) => {
      if (f.repeat !== "none" && !f.due) f.due = ctx.t;
      const q = { id: ctx.S.nextId++, ...f, done: false, doneAt: null, count: 0 };
      ctx.S.quests.push(q);
      return a.quests[i].done ? completeViaClaude(ctx, q) : `Added ${describe(q, ctx.t)}`;
    });
    await ctx.save();
    return out.join("\n");
  },

  async complete_quest(ctx, a) {
    const q = findQuest(ctx.S, a.id);
    if (q.done) return `"${q.name}" is already done.`;
    const msg = completeViaClaude(ctx, q);
    await ctx.save();
    return msg + " Loot rolls when the user opens Quest Log.";
  },

  async update_quest(ctx, a) {
    const q = findQuest(ctx.S, a.id);
    const { id: _id, ...rest } = a;
    Object.assign(q, cleanOrThrow(rest, { partial: true }));
    if (q.repeat !== "none" && !q.due) q.due = ctx.t;
    await ctx.save();
    return `Updated ${describe(q, ctx.t)}`;
  },

  async delete_quest(ctx, a) {
    const q = findQuest(ctx.S, a.id);
    ctx.S.quests = ctx.S.quests.filter((x) => x !== q);
    await ctx.save();
    return `Deleted "${q.name}".`;
  },

  async log_mood(ctx, a) {
    const v = Number(a.value);
    if (!Number.isInteger(v) || v < 1 || v > 10) throw new ToolError("value must be an integer from 1 to 10.");
    const note = String(a.note || "")
      .trim()
      .slice(0, 280);
    const { first, xp } = recordMood(ctx.S, v, note, { today: ctx.t, now: ctx.now, via: "claude" });
    if (first) queueReward(ctx.S, "Mood check-in", xp, ctx.now);
    await ctx.save();
    return `Logged mood ${v}/10 (${moodLabel(v)})${note ? `: "${note}"` : ""}.${first ? ` +${xp} XP.` : ""}`;
  },

  get_summary({ S, t }, a) {
    const days = Math.min(MAX_SUMMARY_DAYS, Math.max(1, Number(a.days) || 7));
    const since = addDays(t, -(days - 1));
    const recent = S.log.filter((e) => e.day >= since);
    const quests = recent.filter((e) => e.t === "quest");
    const xp = recent.reduce((s, e) => s + (e.xp || 0), 0);
    const lv = level(S.xp);
    const st = streak(S.days, t);
    const perDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(t, -i);
      const n = quests.filter((e) => e.day === d).length;
      const m = S.moods.filter((x) => x.day === d).at(-1);
      perDay.push(`  ${d}: ${plural(n, "quest")}${m ? ` · mood ${m.v}/10${m.note ? ` ("${m.note}")` : ""}` : ""}`);
    }
    const byCat = {};
    for (const e of quests) byCat[e.g || "Other"] = (byCat[e.g || "Other"] || 0) + 1;
    const open = S.quests.filter((q) => !q.done);
    const areas = Object.entries(byCat)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    return [
      `Today is ${t}. Last ${days} days:`,
      `Level ${lv.l} (${S.xp} XP total, ${lv.into}/${lv.need} to next) · current streak ${plural(st, "day")}`,
      `${quests.length} quests completed, ${xp} XP earned` + (areas ? ` · by area: ${areas}` : ""),
      `Open quests: ${open.length} (${open.filter((q) => q.due && q.due < t).length} overdue)`,
      `Badges earned: ${Object.keys(S.badges).length}`,
      "Per day:",
      ...perDay,
    ].join("\n");
  },
};

/** Loads the user's state, runs one tool, and saves if the tool changed anything. */
export async function callTool(env, userId, name, args, now = Date.now()) {
  const fn = impl[name];
  if (!fn) throw new ToolError(`Unknown tool ${name}`);
  const user = await getUser(env.DB, userId);
  if (!user) throw new ToolError("No Quest Log data found. Open the app, turn on sync in Settings, then reconnect.");
  const S = upgradeState(user.state);
  const t = localYmd(now, user.tz);
  rollMissed(S.quests, t); // as in the app: missed repeating quests move to today
  const save = async () => {
    S.updatedAt = Date.now();
    await putUser(env.DB, userId, S, user.tz, S.updatedAt);
  };
  return fn({ S, t, tz: user.tz, now, save }, args || {});
}
