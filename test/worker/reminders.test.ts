import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { PushEnv, PushSender } from "../../src/worker/push";
import { runReminders } from "../../src/worker/reminders";
import { createD1 } from "../helpers/d1";
import { OTHER_CODE, emptyState, quest, seedUser } from "../helpers/fixtures";

const NINE_AM_CHICAGO = Date.parse("2026-10-22T14:00:00Z");
let env: PushEnv;
let push: Mock<PushSender>;
let userId: string;

beforeEach(async () => {
  env = { DB: createD1(), VAPID_PRIVATE_JWK: "{}", VAPID_PUBLIC_KEY: "pub", VAPID_SUBJECT: "mailto:t@x" };
  push = vi.fn<PushSender>(async () => 1);
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

describe("runReminders with older saved data", () => {
  it("normalizes quests missing newer fields instead of firing at the wrong time", async () => {
    const legacy = { quests: [{ id: 7, name: "Old quest", xp: 10, due: "2026-10-23" }] }; // no remind/repeat/time
    await env.DB.prepare("UPDATE users SET state = ?").bind(JSON.stringify(legacy)).run();
    expect(await runReminders(env, NINE_AM_CHICAGO, push)).toEqual({ users: 1, queued: 0 }); // due tomorrow
    expect(await runReminders(env, NINE_AM_CHICAGO + 86_400_000, push)).toEqual({ users: 1, queued: 1 });
  });
});
