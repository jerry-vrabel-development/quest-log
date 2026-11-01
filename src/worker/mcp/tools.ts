// MCP tool definitions and implementations. Game rules come from the shared core, so a quest
// completed through Claude earns exactly what it would in the app.
import { cleanExtras, describeExtras } from "../../core/checkin";
import { addDays, localYmd } from "../../core/dates";
import { NOTE_MAX, deleteMood, editMood } from "../../core/moods";
import {
  REMIND_OPTIONS,
  ValidationError,
  byDueTime,
  cleanQuestFields,
  nowView,
  rollMissed,
  upcoming,
  type QuestInput,
} from "../../core/quests";
import { XP_VALUES, completeQuest, level, moodLabel, queueReward, recordMood, streak } from "../../core/rules";
import { upgradeState } from "../../core/state";
import { REPEATS, type Mood, type Quest, type State } from "../../core/types";
import { getUser, putUser } from "../db";

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
      description:
        "An area of life, e.g. Health, Work, Home, Pet, Art, Money, Friends & family, Learning, or the user's own.",
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
} as const;

const moodIdInput = {
  type: "integer",
  description: "The check-in's id, from list_moods or the log_mood reply.",
} as const;

const idInput = { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } as const;

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
      "Record a check-in: mood on the 1-10 scale, with an optional note. Optional extras, each 1-5: anxiety (1 calm … 5 very high), energy (1 empty … 5 full), body (1 rough … 5 strong), focus (1 scattered … 5 locked in); and short notes on sleep and pain. Only log what the user actually said; never guess a number.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "integer", minimum: 1, maximum: 10 },
        note: { type: "string", maxLength: 280 },
        anxiety: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "1 calm, 2 mild, 3 uneasy, 4 high, 5 very high",
        },
        energy: { type: "integer", minimum: 1, maximum: 5, description: "1 empty, 2 low, 3 okay, 4 good, 5 full" },
        body: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "1 rough, 2 not great, 3 okay, 4 good, 5 strong",
        },
        focus: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "1 scattered, 2 foggy, 3 okay, 4 clear, 5 locked in",
        },
        sleep: { type: "string", maxLength: 140, description: "e.g. '5 hours, woke at 3'" },
        pain: { type: "string", maxLength: 140, description: "e.g. 'lower back, mild'" },
      },
      required: ["value"],
    },
  },
  {
    name: "list_moods",
    title: "List mood check-ins",
    description:
      "Mood check-ins over the last N days, newest first, each with its id (for edit_mood and delete_mood), day, time, value and note.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: MAX_SUMMARY_DAYS, description: "Default 7." } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "edit_mood",
    title: "Edit mood check-in",
    description:
      "Fix a check-in's mood value or note by id. Pass only what changes; note:'' clears the note. Only change what the user asked to change.",
    inputSchema: {
      type: "object",
      properties: {
        id: moodIdInput,
        value: { type: "integer", minimum: 1, maximum: 10 },
        note: { type: "string", maxLength: NOTE_MAX },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_mood",
    title: "Delete mood check-in",
    description:
      "Permanently delete a check-in by id. If it was the day's first check-in, its XP moves to the next one that day, or is taken back if it was the only one. Confirm with the user first.",
    inputSchema: { type: "object", properties: { id: moodIdInput }, required: ["id"] },
    annotations: { destructiveHint: true },
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
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];
export const isToolName = (n: unknown): n is ToolName => TOOLS.some((t) => t.name === n);

/** Arguments arrive as untrusted JSON; each tool validates what it reads. */
type Args = Record<string, unknown>;

interface ToolContext {
  S: State;
  /** Today in the user's time zone. */
  t: string;
  tz: string;
  now: number;
  save: () => Promise<void>;
}

/* ---------- formatting ---------- */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const indent = (lines: string[]) => lines.map((l) => "  " + l);

/** One quest as a single line the model can read and refer back to by id. */
export function describe(q: Quest, today: string): string {
  const bits = [`#${q.id} ${q.name}`];
  if (q.done) bits.push("(done)");
  if (q.due) bits.push(`due ${q.due}${q.time ? " " + q.time : ""}${q.due < today && !q.done ? " OVERDUE" : ""}`);
  else if (!q.done) bits.push("anytime");
  if (q.repeat !== "none") bits.push(`repeats ${q.repeat}`);
  bits.push(`[${q.g || "Other"}] +${q.xp}xp`);
  if (q.tiny && !q.done) bits.push(`tiny step: ${q.tiny}`);
  return bits.join(" · ");
}

/* ---------- tool implementations ---------- */

function clean(args: QuestInput): ReturnType<typeof cleanQuestFields>;
function clean(args: QuestInput, partial: true): Partial<ReturnType<typeof cleanQuestFields>>;
function clean(args: QuestInput, partial = false) {
  try {
    return partial ? cleanQuestFields(args, { partial: true }) : cleanQuestFields(args);
  } catch (e) {
    if (e instanceof ValidationError) throw new ToolError(e.message);
    throw e;
  }
}

function findQuest(S: State, id: unknown): Quest {
  const q = S.quests.find((x) => x.id === Number(id));
  if (!q) throw new ToolError(`No quest with id ${String(id)}. Use list_quests to see ids.`);
  return q;
}

/** Explains why a check-in may be missing: sealed ones are only visible on the user's device. */
function findMood(S: State, id: unknown): Mood {
  const m = S.moods.find((x) => x.at === Number(id));
  if (m) return m;
  const sealed =
    isSealed(S) ?
      " Check-ins are end-to-end encrypted once the app syncs, so only ones logged through Claude since then can be changed here; the user can edit or delete the rest in the app (Stats)."
    : "";
  throw new ToolError(`No check-in with id ${String(id)}. Use list_moods to see ids.${sealed}`);
}

const isSealed = (S: State) => typeof (S as { vault?: unknown }).vault === "string";

/** One check-in as a line the model can refer back to by id. */
function describeMood(m: Mood, tz: string): string {
  const time = new Date(m.at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const more = describeExtras(m);
  return `id ${m.at} · ${m.day} ${time} · mood ${m.v}/10 (${moodLabel(m.v)})${more ? ` · ${more}` : ""}${m.note ? ` · "${m.note}"` : ""}`;
}

/** Completes a quest the Claude way: XP now, loot when the app next opens. */
function completeViaClaude(ctx: ToolContext, q: Quest): string {
  const { nextDue } = completeQuest(ctx.S, q, { today: ctx.t, now: ctx.now, via: "claude" });
  queueReward(ctx.S, q.name, q.xp, ctx.now, q.g);
  return `Completed "${q.name}" (+${q.xp} XP).${nextDue ? ` Next one is ${nextDue}.` : ""}`;
}

const impl: Record<ToolName, (ctx: ToolContext, a: Args) => string | Promise<string>> = {
  list_quests({ S, t, tz }, a) {
    const view = typeof a.view === "string" ? a.view : "now";
    const line = (q: Quest) => describe(q, t);
    let lines: string[] = [];
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
        .sort((x, y) => x.g.localeCompare(y.g) || (x.due || "9").localeCompare(y.due || "9") || byDueTime(x, y))
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
    const raw = a.quests;
    if (!Array.isArray(raw) || !raw.length) throw new ToolError("quests must be a non-empty array.");
    if (raw.length > MAX_BATCH) throw new ToolError(`Add at most ${MAX_BATCH} quests at a time.`);
    const inputs = raw as (QuestInput & { done?: unknown })[];
    const fields = inputs.map((q) => clean(q)); // validate all before changing anything
    const out = fields.map((f, i) => {
      if (f.repeat !== "none" && !f.due) f.due = ctx.t;
      const q: Quest = { id: ctx.S.nextId++, ...f, done: false, doneAt: null, count: 0 };
      ctx.S.quests.push(q);
      return inputs[i].done === true ? completeViaClaude(ctx, q) : `Added ${describe(q, ctx.t)}`;
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
    Object.assign(q, clean(rest as QuestInput, true));
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
    const note = (typeof a.note === "string" ? a.note : "").trim().slice(0, 280);
    const extras = cleanExtras(a);
    const { first, xp } = recordMood(ctx.S, v, note, { today: ctx.t, now: ctx.now, via: "claude" }, extras);
    if (first) queueReward(ctx.S, "Mood check-in", xp, ctx.now);
    await ctx.save();
    const more = describeExtras(extras);
    const id = ctx.S.moods.at(-1)?.at ?? ctx.now;
    return `Logged mood ${v}/10 (${moodLabel(v)})${more ? ` · ${more}` : ""}${note ? `: "${note}"` : ""}.${first ? ` +${xp} XP.` : ""} (id ${id})`;
  },

  list_moods({ S, t, tz }, a) {
    const days = Math.min(MAX_SUMMARY_DAYS, Math.max(1, Number(a.days) || 7));
    const since = addDays(t, -(days - 1));
    const lines = S.moods
      .filter((m) => m.day >= since)
      .sort((x, y) => y.at - x.at)
      .map((m) => describeMood(m, tz));
    const sealed =
      isSealed(S) ?
        [
          "(Check-ins are end-to-end encrypted on the user's device. Only ones logged through Claude since the app last synced show here.)",
        ]
      : [];
    return [
      `Check-ins from the last ${plural(days, "day")}:`,
      ...(lines.length ? lines : ["  (none)"]),
      ...sealed,
    ].join("\n");
  },

  async edit_mood(ctx, a) {
    const m = findMood(ctx.S, a.id);
    const v = a.value === undefined ? m.v : Number(a.value);
    if (a.note !== undefined && typeof a.note !== "string") throw new ToolError("note must be a string.");
    const note = typeof a.note === "string" ? a.note : (m.note ?? "");
    try {
      editMood(ctx.S, m.at, { v, note });
    } catch {
      throw new ToolError("value must be an integer from 1 to 10.");
    }
    await ctx.save();
    return `Updated ${describeMood(m, ctx.tz)}`;
  },

  async delete_mood(ctx, a) {
    const m = findMood(ctx.S, a.id);
    const { xpChange } = deleteMood(ctx.S, m.at) ?? { xpChange: 0 };
    await ctx.save();
    return `Deleted the ${m.day} check-in (mood ${m.v}/10).${xpChange ? ` ${xpChange} XP.` : ""}`;
  },

  get_summary({ S, t }, a) {
    const days = Math.min(MAX_SUMMARY_DAYS, Math.max(1, Number(a.days) || 7));
    const since = addDays(t, -(days - 1));
    const recent = S.log.filter((e) => e.day >= since);
    const quests = recent.filter((e) => e.t === "quest");
    const xp = recent.reduce((s, e) => s + (e.xp || 0), 0);
    const lv = level(S.xp);
    const st = streak(S.days, t);
    const perDay: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(t, -i);
      const n = quests.filter((e) => e.day === d).length;
      const m = S.moods.filter((x) => x.day === d).at(-1);
      const more = m ? describeExtras(m) : "";
      perDay.push(
        `  ${d}: ${plural(n, "quest")}${m ? ` · mood ${m.v}/10${more ? ` · ${more}` : ""}${m.note ? ` ("${m.note}")` : ""}` : ""}`,
      );
    }
    const byCat: Record<string, number> = {};
    for (const e of quests) byCat[e.g || "Other"] = (byCat[e.g || "Other"] || 0) + 1;
    const open = S.quests.filter((q) => !q.done);
    const areas = Object.entries(byCat)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    const sealedNote =
      isSealed(S) ?
        [
          "(Check-ins, notes and moments are end-to-end encrypted on the user's device. Only check-ins logged through Claude since the app last synced show here.)",
        ]
      : [];
    return [
      `Today is ${t}. Last ${days} days:`,
      `Level ${lv.l} (${S.xp} XP total, ${lv.into}/${lv.need} to next) · current streak ${plural(st, "day")}`,
      `${quests.length} quests completed, ${xp} XP earned` + (areas ? ` · by area: ${areas}` : ""),
      `Open quests: ${open.length} (${open.filter((q) => q.due && q.due < t).length} overdue)`,
      `Badges earned: ${Object.keys(S.badges).length}`,
      "Per day:",
      ...perDay,
      ...sealedNote,
    ].join("\n");
  },
};

/** Loads the user's state, runs one tool, and saves if the tool changed anything. */
export async function callTool(
  env: Pick<Env, "DB">,
  userId: string,
  name: ToolName,
  args: Args,
  now: number = Date.now(),
): Promise<string> {
  const user = await getUser(env.DB, userId);
  if (!user) throw new ToolError("No Quest Log data found. Open the app, turn on sync in Settings, then reconnect.");
  const S = upgradeState(user.state);
  const t = localYmd(now, user.tz);
  rollMissed(S.quests, t); // as in the app: missed repeating quests move to today
  const save = async () => {
    S.updatedAt = Date.now();
    await putUser(env.DB, userId, S, user.tz, S.updatedAt);
  };
  return impl[name]({ S, t, tz: user.tz, now, save }, args);
}
