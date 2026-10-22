import { beforeAll, describe, expect, it, vi } from "vitest";
import { pushUser, vapidJwt, type FetchLike, type PushEnv } from "../../src/worker/push";
import { createD1 } from "../helpers/d1";

const b64urlDecode = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) =>
    c.charCodeAt(0),
  );
let env: PushEnv;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  publicKey = pair.publicKey;
  env = {
    DB: createD1(),
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    VAPID_PUBLIC_KEY: "pub",
    VAPID_SUBJECT: "mailto:test@example.com",
  };
});

describe("vapidJwt", () => {
  it("produces an ES256 JWT that verifies with the public key", async () => {
    const now = Date.UTC(2026, 9, 22);
    const jwt = await vapidJwt(env, "https://push.example.com", now);
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(p)))).toEqual({
      aud: "https://push.example.com",
      exp: now / 1000 + 12 * 3600,
      sub: "mailto:test@example.com",
    });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      b64urlDecode(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});

describe("pushUser", () => {
  it("sends an empty push to each device and drops subscriptions the push service says are gone", async () => {
    for (const e of ["https://a.push/1", "https://b.push/2", "https://c.push/3"]) {
      await env.DB.prepare("INSERT INTO subs (endpoint, user_id, created_at) VALUES (?, 'u1', 0)").bind(e).run();
    }
    const status: Record<string, number> = {
      "https://a.push/1": 201,
      "https://b.push/2": 410,
      "https://c.push/3": 500,
    };
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      expect(init.body).toBe("");
      expect(init.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=pub$/);
      return new Response("", { status: status[url] });
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await pushUser(env, "u1", fetchImpl)).toBe(1);
    const left = (
      await env.DB.prepare("SELECT endpoint FROM subs ORDER BY endpoint").all<{ endpoint: string }>()
    ).results.map((r) => r.endpoint);
    expect(left).toEqual(["https://a.push/1", "https://c.push/3"]);
  });
});
