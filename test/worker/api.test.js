import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_STATE_BYTES, handleApi } from "../../src/api.js";
import { createD1 } from "../helpers/d1.js";
import { CODE, OTHER_CODE, emptyState, quest } from "../helpers/fixtures.js";

let env, push;
beforeEach(() => {
  env = { DB: createD1(), VAPID_PUBLIC_KEY: "test-public-key" };
  push = vi.fn(async () => 1);
});

function call(method, path, { body, code = CODE, raw } = {}) {
  const headers = code ? { Authorization: `Bearer ${code}` } : {};
  const init = { method, headers };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return handleApi(new Request(`https://q.test${path}`, init), env, { push });
}
const put = (state, extra = {}, code = CODE) =>
  call("PUT", "/api/state", { body: { state, updatedAt: 2000, tz: "America/Chicago", ...extra }, code });

describe("auth", () => {
  it("serves the VAPID key without auth", async () => {
    const res = await call("GET", "/api/config", { code: null });
    expect(await res.json()).toEqual({ vapidPublicKey: "test-public-key" });
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
    expect(await (await put(state)).json()).toEqual({ ok: true, updatedAt: 2000 });
    const got = await (await call("GET", "/api/state")).json();
    expect(got).toEqual({ state, updatedAt: 2000, tz: "America/Chicago" });
  });

  it("refuses an older write with 409 so the client pulls first", async () => {
    await put(emptyState(), { updatedAt: 5000 });
    const res = await put(emptyState(), { updatedAt: 4000 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", updatedAt: 5000 });
  });

  it("lets force overwrite (used when restoring a backup)", async () => {
    await put(emptyState(), { updatedAt: 5000 });
    expect((await put(emptyState({ xp: 99 }), { updatedAt: 4000, force: true })).status).toBe(200);
    expect((await (await call("GET", "/api/state")).json()).state.xp).toBe(99);
  });

  it("keeps each sync code's data separate", async () => {
    await put(emptyState({ xp: 1 }));
    expect((await call("GET", "/api/state", { code: OTHER_CODE })).status).toBe(404);
  });

  it("falls back to Chicago for an invalid time zone", async () => {
    await put(emptyState(), { tz: "Nowhere/Land" });
    expect((await (await call("GET", "/api/state")).json()).tz).toBe("America/Chicago");
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
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM subs").first()).n).toBe(1);
    await call("DELETE", "/api/subscribe", { body: { endpoint } });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM subs").first()).n).toBe(0);
  });

  it("can't unsubscribe someone else's device", async () => {
    await call("POST", "/api/subscribe", { body: { endpoint } });
    await call("DELETE", "/api/subscribe", { body: { endpoint }, code: OTHER_CODE });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM subs").first()).n).toBe(1);
  });

  it("test push queues a notification that the outbox hands out exactly once", async () => {
    const res = await call("POST", "/api/test-push");
    expect(await res.json()).toEqual({ ok: true, sent: 1 });
    expect(push).toHaveBeenCalledOnce();

    const first = await (await call("GET", "/api/outbox")).json();
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ title: "Quest Log test" });
    expect((await (await call("GET", "/api/outbox")).json()).items).toEqual([]);
  });

  it("another user's outbox stays private", async () => {
    await call("POST", "/api/test-push");
    expect((await (await call("GET", "/api/outbox", { code: OTHER_CODE })).json()).items).toEqual([]);
  });
});
