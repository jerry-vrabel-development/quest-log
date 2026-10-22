// Web Push with VAPID and an empty payload.
//
// The cron writes notification text to the outbox table and sends an EMPTY push, so no payload
// encryption (RFC 8291) is needed. The service worker wakes up, fetches /api/outbox with the
// sync code and shows the notifications.
import { dropSub, subsFor } from "./db.js";
import { b64url } from "./http.js";

const JWT_TTL_S = 12 * 3600;

/** Pushes to every device the user subscribed. Returns how many accepted it. Expired subscriptions are removed. */
export async function pushUser(env, userId, fetchImpl = fetch) {
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

async function sendPush(env, endpoint, fetchImpl) {
  const jwt = await vapidJwt(env, new URL(endpoint).origin);
  return fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`, TTL: "86400", Urgency: "high" },
    body: "",
  });
}

const keyCache = new Map();

/** An ES256-signed VAPID JWT (RFC 8292) for a push service origin. */
export async function vapidJwt(env, aud, now = Date.now()) {
  let key = keyCache.get(env.VAPID_PRIVATE_JWK);
  if (!key) {
    key = await crypto.subtle.importKey(
      "jwk",
      { ...JSON.parse(env.VAPID_PRIVATE_JWK), ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    keyCache.set(env.VAPID_PRIVATE_JWK, key);
  }
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud,
    exp: Math.floor(now / 1000) + JWT_TTL_S,
    sub: env.VAPID_SUBJECT,
  })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}
