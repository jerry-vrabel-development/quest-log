import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSIONS, handleMcp } from "../../src/mcp/server.js";
import { TOOLS } from "../../src/mcp/tools.js";
import { createD1 } from "../helpers/d1.js";
import { emptyState, quest, seedUser } from "../helpers/fixtures.js";

// Freeze "now" at 10am Oct 22 2026 in Chicago (the user's zone).
const NOW = Date.parse("2026-10-22T15:00:00Z");
let env, userId, nextId;

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  env = { DB: createD1() };
  nextId = 1;
  userId = await seedUser(
    env.DB,
    emptyState({
      quests: [
        quest(1, { name: "Walk Bash", g: "Bash", due: "2026-10-18", repeat: "daily", xp: 10 }),
        quest(2, { name: "Apply to one job", g: "Career", due: "2026-10-22", xp: 20 }),
        quest(3, { name: "Fix headline", g: "Career", xp: 15 }),
      ],
      nextId: 4,
    }),
  );
});
afterEach(() => vi.useRealTimers());

async function rpc(method, params, { id = nextId++, as = userId } = {}) {
  const req = new Request("https://q.test/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return (await handleMcp(req, env, { props: { userId: as } })).json();
}
async function tool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  return { text: r.result.content[0].text, isError: !!r.result.isError };
}
const state = async () => JSON.parse((await env.DB.prepare("SELECT state FROM users").first()).state);

describe("protocol", () => {
  it("negotiates the protocol version", async () => {
    expect((await rpc("initialize", { protocolVersion: "2025-06-18" })).result.protocolVersion).toBe("2025-06-18");
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion).toBe(
      PROTOCOL_VERSIONS[0],
    );
  });

  it("advertises tools with annotations", async () => {
    const { tools } = (await rpc("tools/list")).result;
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(tools.find((t) => t.name === "delete_quest").annotations.destructiveHint).toBe(true);
  });

  it("acknowledges notifications with 202 and no body", async () => {
    const req = new Request("https://q.test/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    const res = await handleMcp(req, env, { props: { userId } });
    expect(res.status).toBe(202);
  });

  it.each(["GET", "DELETE", "PUT"])("rejects %s with 405", async (method) => {
    expect((await handleMcp(new Request("https://q.test/mcp", { method }), env, {})).status).toBe(405);
  });

  it("returns JSON-RPC errors for bad input", async () => {
    const send = async (body) =>
      (await handleMcp(new Request("https://q.test/mcp", { method: "POST", body }), env, {})).json();
    expect((await send("{nope")).error.code).toBe(-32700);
    expect((await send("[]")).error.code).toBe(-32600);
    expect((await send(JSON.stringify({ id: 1, method: "ping" }))).error.code).toBe(-32600);
    expect((await rpc("no/such/method")).error.code).toBe(-32601);
    expect((await rpc("tools/call", { name: "hack" })).error.code).toBe(-32602);
  });
});

describe("tools", () => {
  it("list_quests 'now' rolls missed dailies to today and shows the user's date", async () => {
    const { text } = await tool("list_quests");
    expect(text).toContain("Today is 2026-10-22 (America/Chicago)");
    expect(text).toMatch(/Today:\n {2}#1 Walk Bash · due 2026-10-22 · repeats daily.*\n {2}#2 Apply to one job/);
    expect(text).not.toContain("OVERDUE");
    expect(text).toMatch(/Anytime:\n {2}#3 Fix headline/);
  });

  it("add_quests adds with defaults and can record something already done", async () => {
    const { text } = await tool("add_quests", {
      quests: [
        { name: "Plaster ceiling", tiny: "Mix one batch", category: "House", due: "2026-10-23" },
        { name: "Neck stretch", done: true, xp: 5 },
      ],
    });
    expect(text).toContain("Added #4 Plaster ceiling · due 2026-10-23 · [House] +15xp · tiny step: Mix one batch");
    expect(text).toContain('Completed "Neck stretch" (+5 XP).');
    const S = await state();
    expect(S.quests.map((q) => q.id)).toEqual([1, 2, 3, 4, 5]);
    expect(S.xp).toBe(5);
    expect(S.rewards).toEqual([{ name: "Neck stretch", xp: 5, at: NOW }]);
  });

  it("add_quests is all-or-nothing when one quest is invalid", async () => {
    const r = await tool("add_quests", { quests: [{ name: "Fine" }, { name: "Bad", xp: 999 }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/xp must be one of/);
    expect((await state()).quests).toHaveLength(3);
  });

  it("complete_quest completes a one-off and queues its loot roll for the app", async () => {
    const { text } = await tool("complete_quest", { id: 2 });
    expect(text).toBe('Completed "Apply to one job" (+20 XP). Loot rolls when the user opens Quest Log.');
    const S = await state();
    expect(S.quests[1]).toMatchObject({ done: true, doneAt: NOW });
    expect(S.log[0]).toMatchObject({ t: "quest", via: "claude", day: "2026-10-22" });
    expect(S.days).toEqual(["2026-10-22"]);
    expect(S.updatedAt).toBe(NOW);
    expect((await tool("complete_quest", { id: 2 })).text).toBe('"Apply to one job" is already done.');
  });

  it("complete_quest rolls a repeating quest to tomorrow", async () => {
    expect((await tool("complete_quest", { id: 1 })).text).toContain("Next one is 2026-10-23.");
    expect((await state()).quests[0]).toMatchObject({ due: "2026-10-23", count: 1, done: false });
  });

  it("update_quest changes only the given fields", async () => {
    const { text } = await tool("update_quest", { id: 3, due: "2026-10-24", time: "10:30" });
    expect(text).toBe("Updated #3 Fix headline · due 2026-10-24 10:30 · [Career] +15xp");
    expect((await tool("update_quest", { id: 3, time: "nine" })).isError).toBe(true);
  });

  it("delete_quest removes it; unknown ids are a tool error, not a crash", async () => {
    expect((await tool("delete_quest", { id: 3 })).text).toBe('Deleted "Fix headline".');
    expect(await tool("delete_quest", { id: 3 })).toEqual({
      text: "No quest with id 3. Use list_quests to see ids.",
      isError: true,
    });
  });

  it("log_mood validates the scale and only rewards the first check-in of the day", async () => {
    expect((await tool("log_mood", { value: 11 })).isError).toBe(true);
    expect((await tool("log_mood", { value: 4, note: "sore back" })).text).toBe(
      'Logged mood 4/10 (Low): "sore back". +5 XP.',
    );
    expect((await tool("log_mood", { value: 5 })).text).toBe("Logged mood 5/10 (Meh).");
    const S = await state();
    expect(S.moods.map((m) => m.v)).toEqual([4, 5]);
    expect(S.xp).toBe(5);
  });

  it("get_summary reports the week", async () => {
    await tool("complete_quest", { id: 2 });
    await tool("log_mood", { value: 6, note: "coffee helped" });
    const { text } = await tool("get_summary", { days: 3 });
    expect(text).toContain("Level 1 (25 XP total, 25/50 to next) · current streak 1 day");
    expect(text).toContain("1 quests completed, 25 XP earned · by area: Career 1");
    expect(text).toContain('  2026-10-22: 1 quest · mood 6/10 ("coffee helped")');
    expect(text).toContain("  2026-10-20: 0 quests");
  });

  it("explains what to do when the account has no data", async () => {
    const r = await rpc("tools/call", { name: "list_quests", arguments: {} }, { as: "nobody" });
    expect(r.result).toMatchObject({ isError: true });
    expect(r.result.content[0].text).toMatch(/turn on sync/);
  });
});
