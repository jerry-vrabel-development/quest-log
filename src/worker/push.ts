// Web Push with VAPID and an empty payload.
//
// The cron writes notification text to the outbox table and sends an EMPTY push, so no payload
// encryption (RFC 8291) is needed. The service worker wakes up, fetches /api/outbox with the
// sync code and shows the notifications.
import { dropSub, subsFor } from "./db";
import { b64url } from "./http";

const JWT_TTL_S = 12 * 3600;

export type PushEnv = Pick<Env, "DB" | "VAPID_PRIVATE_JWK" | "VAPID_PUBLIC_KEY" | "VAPID_SUBJECT">;
export type FetchLike = (url: string, init: RequestInit & { headers: Record<string, string> }) => Promise<Response>;
export type PushSender = (env: PushEnv, userId: string) => Promise<number>;

/** Pushes to every device the user subscribed. Returns how many accepted it. Expired subscriptions are removed. */
export async function pushUser(env: PushEnv, userId: string, fetchImpl: FetchLike = fetch): Promise<number> {
  let ok = 0;
  for (const endpoint of await subsFor(env.DB, userId)) {
    try {
      const res = await sendPush(env, endpoint, fetchImpl);
      if (res.status === 404 || res.status === 410) await dropSub(env.DB, endpoint);
      else if (res.ok) ok++;
      else console.warn("push failed", res.status, await res.text());
    } catch (e) {
      console.warn("push error", e);
    }
  }
  return ok;
}

async function sendPush(env: PushEnv, endpoint: string, fetchImpl: FetchLike): Promise<Response> {
  const jwt = await vapidJwt(env, new URL(endpoint).origin);
  return fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`, TTL: "86400", Urgency: "high" },
    body: "",
  });
}

const keyCache = new Map<string, CryptoKey>();

/** An ES256-signed VAPID JWT (RFC 8292) for a push service origin. */
export async function vapidJwt(
  env: Pick<PushEnv, "VAPID_PRIVATE_JWK" | "VAPID_SUBJECT">,
  aud: string,
  now: number = Date.now(),
): Promise<string> {
  let key = keyCache.get(env.VAPID_PRIVATE_JWK);
  if (!key) {
    key = await crypto.subtle.importKey(
      "jwk",
      { ...(JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey), ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    keyCache.set(env.VAPID_PRIVATE_JWK, key);
  }
  const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud,
    exp: Math.floor(now / 1000) + JWT_TTL_S,
    sub: env.VAPID_SUBJECT,
  })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}
