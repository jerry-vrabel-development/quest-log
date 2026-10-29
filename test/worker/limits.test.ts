// Rate limits (#64): per account on the API and the connector, per IP on sign-in routes.
import { beforeEach, describe, expect, it } from "vitest";
import { handleApi, type ApiEnv } from "../../src/worker/api";
import { RETRY_AFTER_S, overLimit } from "../../src/worker/limits";
import worker from "../../src/worker/worker";
import { createD1 } from "../helpers/d1";
import { CODE, OTHER_CODE, emptyState, seedUser } from "../helpers/fixtures";
import { body } from "../helpers/http";
import { createLimiter } from "../helpers/limits";
import { createR2 } from "../helpers/r2";

let env: ApiEnv;
beforeEach(async () => {
  env = {
    DB: createD1(),
    MEDIA: createR2(),
    VAPID_PUBLIC_KEY: "k",
    VAPID_PRIVATE_JWK: "{}",
    VAPID_SUBJECT: "mailto:t@x",
  };
  await seedUser(env.DB, emptyState());
});

const get = (path: string, code = CODE) =>
  handleApi(new Request(`https://q.test${path}`, { headers: { Authorization: `Bearer ${code}` } }), env);

describe("rate limits", () => {
  it("API: over the limit answers 429 with Retry-After, per account", async () => {
    env.API_LIMIT = createLimiter(2);
    expect((await get("/api/state")).status).toBe(200);
    expect((await get("/api/state")).status).toBe(200);
    const res = await get("/api/state");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(RETRY_AFTER_S));
    expect(await body(res)).toEqual({ error: "rate_limited", retryAfter: RETRY_AFTER_S });
    expect((await get("/api/state", OTHER_CODE)).status).not.toBe(429); // another account isn't affected
  });

  it("API: keys by account, never by the raw sync code", async () => {
    const limiter = createLimiter(100);
    env.API_LIMIT = limiter;
    await get("/api/state");
    expect(limiter.keys).toHaveLength(1);
    expect(limiter.keys[0]).not.toContain(CODE);
  });

  it("media uploads have their own, tighter limit", async () => {
    env.MEDIA_LIMIT = createLimiter(1);
    const upload = () =>
      handleApi(
        new Request("https://q.test/api/media/abcdefgh-1234", {
          method: "PUT",
          headers: { Authorization: `Bearer ${CODE}`, "content-length": "3" },
          body: new Uint8Array([1, 2, 3]),
        }),
        env,
      );
    expect((await upload()).status).toBe(200);
    expect((await upload()).status).toBe(429);
    expect((await get("/api/media")).status).toBe(200); // reading isn't limited by the upload limit
  });

  it("unauthenticated calls are refused before they count against anyone", async () => {
    const limiter = createLimiter(0);
    env.API_LIMIT = limiter;
    expect((await handleApi(new Request("https://q.test/api/state"), env)).status).toBe(401);
    expect(limiter.keys).toEqual([]);
  });

  it("fails open: a broken limiter never blocks real use", async () => {
    expect(await overLimit({ limit: () => Promise.reject(new Error("down")) }, "k")).toBe(false);
    expect(await overLimit(undefined, "k")).toBe(false);
  });

  it("sign-in routes are limited per IP; reading the consent page isn't", async () => {
    const auth = createLimiter(1);
    const wenv = { ...env, AUTH_LIMIT: auth, ASSETS: { fetch: async () => new Response("asset") } } as unknown as Env;
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const register = () =>
      worker.fetch(
        new Request("https://q.test/oauth/register", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
          body: "{}",
        }),
        wenv,
        ctx,
      );
    await register().catch(() => undefined); // first one goes through to the OAuth provider
    const res = await register();
    expect(res.status).toBe(429);
    expect(auth.keys).toEqual(["203.0.113.9", "203.0.113.9"]);
    const page = await worker.fetch(new Request("https://q.test/authorize"), wenv, ctx).catch(() => null);
    expect(page?.status).not.toBe(429);
    expect(auth.keys).toHaveLength(2); // GET /authorize didn't count
  });
});
