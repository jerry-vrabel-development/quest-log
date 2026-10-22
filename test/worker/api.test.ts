import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { State } from "../../src/core/types";
import { MAX_STATE_BYTES, handleApi, type ApiEnv } from "../../src/worker/api";
import type { PushSender } from "../../src/worker/push";
import { createD1, type TestD1 } from "../helpers/d1";
import { CODE, OTHER_CODE, emptyState, quest } from "../helpers/fixtures";
import { body as read } from "../helpers/http";

let env: ApiEnv & { DB: TestD1 };
let push: Mock<PushSender>;
beforeEach(() => {
  env = { DB: createD1(), VAPID_PUBLIC_KEY: "test-public-key", VAPID_PRIVATE_JWK: "{}", VAPID_SUBJECT: "mailto:t@x" };
  push = vi.fn<PushSender>(async () => 1);
});

interface CallOptions {
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as is (for malformed bodies). */
  raw?: string;
  /** Sync code for the Authorization header; null sends none. */
  code?: string | null;
}

function call(method: string, path: string, { body, code = CODE, raw }: CallOptions = {}): Promise<Response> {
  const init: RequestInit = { method, headers: code ? { Authorization: `Bearer ${code}` } : {} };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return handleApi(new Request(`https://q.test${path}`, init), env, { push });
}
const put = (state: State, extra: Record<string, unknown> = {}, code = CODE) =>
  call("PUT", "/api/state", { body: { state, updatedAt: 2000, tz: "America/Chicago", ...extra }, code });
const count = async (table: string) =>
  ((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()) ?? { n: 0 }).n;

describe("auth", () => {
  it("serves the VAPID key without auth", async () => {
    const res = await call("GET", "/api/config", { code: null });
    expect(await read(res)).toEqual({ vapidPublicKey: "test-public-key" });
  });

  it.each([null, "short", "has spaces in it but is long enough to pass length"])(
    "rejects sync code %j",
    async (code) => {
      const res = await call("GET", "/api/state", { code });
      expect(res.status).toBe(401);
    },
  );

  it("404s unknown routes", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
  });
});

describe("state sync", () => {
  it("404s before the first upload, then round-trips the state", async () => {
    expect((await call("GET", "/api/state")).status).toBe(404);
    const state = emptyState({ quests: [quest(1)] });
    expect(await read(await put(state))).toEqual({ ok: true, updatedAt: 2000 });
    const got = await read(await call("GET", "/api/state"));
    expect(got).toEqual({ state, updatedAt: 2000, tz: "America/Chicago" });
  });

  it("refuses an older write with 409 so the client pulls first", async () => {
    await put(emptyState(), { updatedAt: 5000 });
    const res = await put(emptyState(), { updatedAt: 4000 });
    expect(res.status).toBe(409);
    expect(await read(res)).toEqual({ error: "conflict", updatedAt: 5000 });
  });

  it("lets force overwrite (used when restoring a backup)", async () => {
    await put(emptyState(), { updatedAt: 5000 });
    expect((await put(emptyState({ xp: 99 }), { updatedAt: 4000, force: true })).status).toBe(200);
    expect((await read(await call("GET", "/api/state"))).state.xp).toBe(99);
  });

  it("keeps each sync code's data separate", async () => {
    await put(emptyState({ xp: 1 }));
    expect((await call("GET", "/api/state", { code: OTHER_CODE })).status).toBe(404);
  });

  it("falls back to Chicago for an invalid time zone", async () => {
    await put(emptyState(), { tz: "Nowhere/Land" });
    expect((await read(await call("GET", "/api/state"))).tz).toBe("America/Chicago");
  });

  it.each([
    ["malformed JSON", { raw: "{nope" }, 400],
    ["missing quests", { body: { state: {} } }, 400],
    ["oversized body", { raw: JSON.stringify({ state: { quests: [], pad: "x".repeat(MAX_STATE_BYTES) } }) }, 413],
  ])("rejects %s", async (_, opts, status) => {
    expect((await call("PUT", "/api/state", opts)).status).toBe(status);
  });
});

describe("push subscriptions and outbox", () => {
  const endpoint = "https://push.example.com/send/abc";

  it("validates the endpoint", async () => {
    expect((await call("POST", "/api/subscribe", { body: { endpoint: "http://insecure" } })).status).toBe(400);
    expect((await call("POST", "/api/subscribe", { raw: "nope" })).status).toBe(400);
  });

  it("subscribes and unsubscribes", async () => {
    await call("POST", "/api/subscribe", { body: { endpoint } });
    expect(await count("subs")).toBe(1);
    await call("DELETE", "/api/subscribe", { body: { endpoint } });
    expect(await count("subs")).toBe(0);
  });

  it("can't unsubscribe someone else's device", async () => {
    await call("POST", "/api/subscribe", { body: { endpoint } });
    await call("DELETE", "/api/subscribe", { body: { endpoint }, code: OTHER_CODE });
    expect(await count("subs")).toBe(1);
  });

  it("test push queues a notification that the outbox hands out exactly once", async () => {
    const res = await call("POST", "/api/test-push");
    expect(await read(res)).toEqual({ ok: true, sent: 1 });
    expect(push).toHaveBeenCalledOnce();

    const first = await read(await call("GET", "/api/outbox"));
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ title: "Quest Log test" });
    expect((await read(await call("GET", "/api/outbox"))).items).toEqual([]);
  });

  it("another user's outbox stays private", async () => {
    await call("POST", "/api/test-push");
    expect((await read(await call("GET", "/api/outbox", { code: OTHER_CODE }))).items).toEqual([]);
  });
});
