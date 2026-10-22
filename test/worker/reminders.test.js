import { beforeEach, describe, expect, it, vi } from "vitest";
import { runReminders } from "../../src/reminders.js";
import { createD1 } from "../helpers/d1.js";
import { OTHER_CODE, emptyState, quest, seedUser } from "../helpers/fixtures.js";

const NINE_AM_CHICAGO = Date.parse("2026-10-22T14:00:00Z");
let env, push, userId;

beforeEach(async () => {
  env = { DB: createD1() };
  push = vi.fn(async () => 1);
  userId = await seedUser(env.DB, emptyState({ quests: [quest(1, { name: "Walk", due: "2026-10-22" })] }));
  await env.DB.prepare("INSERT INTO subs (endpoint, user_id, created_at) VALUES (?, ?, ?)")
    .bind("https://push.test/1", userId, 0)
    .run();
});

const outbox = async () => (await env.DB.prepare("SELECT user_id, title, tag FROM outbox").all()).results;

describe("runReminders", () => {
  it("does nothing before a reminder is due", async () => {
    expect(await runReminders(env, NINE_AM_CHICAGO - 60_000, push)).toEqual({ users: 1, queued: 0 });
    expect(push).not.toHaveBeenCalled();
  });

  it("queues a due reminder and pushes once, even when the cron runs again", async () => {
    expect(await runReminders(env, NINE_AM_CHICAGO, push)).toEqual({ users: 1, queued: 1 });
    expect(await runReminders(env, NINE_AM_CHICAGO + 5 * 60_000, push)).toEqual({ users: 1, queued: 0 });
    expect(push).toHaveBeenCalledOnce();
    expect(await outbox()).toEqual([{ user_id: userId, title: "Walk", tag: "1@2026-10-22" }]);
  });

  it("skips users without a push subscription", async () => {
    await seedUser(env.DB, emptyState({ quests: [quest(1, { due: "2026-10-22" })] }), { code: OTHER_CODE });
    expect((await runReminders(env, NINE_AM_CHICAGO, push)).users).toBe(1);
  });

  it("survives a corrupt state row", async () => {
    await env.DB.prepare("UPDATE users SET state = '{oops'").run();
    expect(await runReminders(env, NINE_AM_CHICAGO, push)).toEqual({ users: 1, queued: 0 });
  });
});
