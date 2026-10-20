// Quest Log — Cloudflare Worker
// Serves the PWA (static assets), syncs state to D1, sends Web Push reminders from a cron,
// and exposes an OAuth-protected MCP server at /mcp so Claude can manage quests.
//
// Push design: the cron writes the notification text to an "outbox" table and sends an
// EMPTY push (no payload, so no payload encryption needed). The service worker wakes up,
// fetches /api/outbox with the sync code, and shows the notifications.

const MAX_STATE_BYTES = 1_000_000;
const REMINDER_GRACE_MS = 6 * 3600_000; // stop nagging 6h after the due time

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { handleMcp } from "./mcp.js";
import { handleAuthorize } from "./authorize.js";

// The app itself: static PWA, sync API and the OAuth consent page.
const app = {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/authorize") return handleAuthorize(req, env);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (err) {
      console.error(err);
      return json({ error: "server_error" }, 500);
    }
  },
};

// OAuth 2.1 in front of /mcp (the Claude connector). One provider per origin, so the
// connector works on both the workers.dev URL and a custom domain.
const providers = new Map();
function providerFor(origin) {
  if (!providers.has(origin)) {
    providers.set(origin, new OAuthProvider({
      apiRoute: "/mcp",
      apiHandler: { fetch: handleMcp },
      defaultHandler: app,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: ["quests", "offline_access"],
      requiredScopes: ["quests"],
      refreshTokenIdleTTL: 60 * 86400, // stay connected while in use
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "Quest Log" },
    }));
  }
  return providers.get(origin);
}

export default {
  fetch(req, env, ctx) {
    return providerFor(new URL(req.url).origin).fetch(req, env, ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, Date.now()));
  },
};

/* ---------------- API ---------------- */

async function api(req, env, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/config") return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY });

  const userId = await authUser(req);
  if (!userId) return json({ error: "unauthorized" }, 401);

  switch (route) {
    case "GET /api/state": {
      const row = await env.DB.prepare("SELECT state, updated_at, tz FROM users WHERE id = ?").bind(userId).first();
      if (!row) return json({ error: "not_found" }, 404);
      return json({ state: JSON.parse(row.state), updatedAt: row.updated_at, tz: row.tz });
    }

    case "PUT /api/state": {
      const text = await req.text();
      if (text.length > MAX_STATE_BYTES) return json({ error: "too_large" }, 413);
      const body = JSON.parse(text);
      if (!body || typeof body.state !== "object" || !Array.isArray(body.state.quests)) return json({ error: "bad_state" }, 400);
      const updatedAt = Number(body.updatedAt) || Date.now();
      const tz = validTz(body.tz) ? body.tz : "America/Chicago";
      const existing = await env.DB.prepare("SELECT updated_at FROM users WHERE id = ?").bind(userId).first();
      if (existing && existing.updated_at > updatedAt && !body.force) {
        // another device saved something newer — client should pull and merge
        return json({ error: "conflict", updatedAt: existing.updated_at }, 409);
      }
      await env.DB.prepare(
        `INSERT INTO users (id, state, tz, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET state = ?2, tz = ?3, updated_at = ?4`
      ).bind(userId, JSON.stringify(body.state), tz, updatedAt).run();
      return json({ ok: true, updatedAt });
    }

    case "POST /api/subscribe": {
      const { endpoint } = await req.json();
      if (!isPushEndpoint(endpoint)) return json({ error: "bad_endpoint" }, 400);
      await env.DB.prepare(
        `INSERT INTO subs (endpoint, user_id, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = ?2`
      ).bind(endpoint, userId, Date.now()).run();
      return json({ ok: true });
    }

    case "DELETE /api/subscribe": {
      const { endpoint } = await req.json();
      await env.DB.prepare("DELETE FROM subs WHERE endpoint = ? AND user_id = ?").bind(endpoint, userId).run();
      return json({ ok: true });
    }

    case "GET /api/outbox": {
      const { results } = await env.DB.prepare(
        "SELECT id, title, body, tag FROM outbox WHERE user_id = ? AND delivered = 0 ORDER BY id LIMIT 10"
      ).bind(userId).all();
      if (results.length) {
        await env.DB.prepare(
          `UPDATE outbox SET delivered = 1 WHERE user_id = ? AND id IN (${results.map(() => "?").join(",")})`
        ).bind(userId, ...results.map((r) => r.id)).run();
      }
      // tidy up old rows
      await env.DB.prepare("DELETE FROM outbox WHERE created_at < ?").bind(Date.now() - 7 * 86400_000).run();
      return json({ items: results });
    }

    case "POST /api/test-push": {
      await env.DB.prepare(
        "INSERT INTO outbox (user_id, title, body, tag, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(userId, "Quest Log test", "Push reminders are working. Go get some loot.", "test-" + Date.now(), Date.now()).run();
      const sent = await pushUser(env, userId);
      return json({ ok: true, sent });
    }
  }
  return json({ error: "not_found" }, 404);
}

async function authUser(req) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{32,128})$/.exec(req.headers.get("Authorization") || "");
  if (!m) return null;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(m[1]));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function isPushEndpoint(s) {
  try { const u = new URL(s); return u.protocol === "https:" && s.length < 1000; } catch { return false; }
}
function validTz(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return typeof tz === "string"; } catch { return false; }
}

/* ---------------- reminders (cron) ---------------- */

export async function runReminders(env, now) {
  const { results: users } = await env.DB.prepare(
    "SELECT u.id, u.state, u.tz FROM users u WHERE EXISTS (SELECT 1 FROM subs s WHERE s.user_id = u.id)"
  ).all();

  let queued = 0;
  for (const u of users) {
    let state;
    try { state = JSON.parse(u.state); } catch { continue; }
    const due = dueReminders(state, u.tz, now);
    let fresh = 0;
    for (const r of due) {
      const ins = await env.DB.prepare("INSERT OR IGNORE INTO sent (user_id, key, at) VALUES (?, ?, ?)")
        .bind(u.id, r.key, now).run();
      if (!ins.meta.changes) continue; // already sent
      await env.DB.prepare("INSERT INTO outbox (user_id, title, body, tag, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(u.id, r.title, r.body, r.key, now).run();
      fresh++;
    }
    if (fresh) { queued += fresh; await pushUser(env, u.id); }
  }
  await env.DB.prepare("DELETE FROM sent WHERE at < ?").bind(now - 30 * 86400_000).run();
  return { users: users.length, queued };
}

// Mirrors fireTime() in the app: no time set means 9:00 AM; remind < 0 means off.
export function dueReminders(state, tz, now) {
  const out = [];
  const today = localYmd(now, tz);
  for (const q of state.quests || []) {
    if (!q.due || q.done) continue;
    const remind = q.remind ?? 0;
    if (remind < 0) continue;
    let due = q.due;
    if (q.repeat && q.repeat !== "none") while (due < today) due = advanceYmd(due, q.repeat);
    const [y, mo, d] = due.split("-").map(Number);
    const [h, mi] = (q.time || "09:00").split(":").map(Number);
    const dueAt = zonedTimeToUtc(y, mo, d, h, mi, tz);
    const at = dueAt - remind * 60_000;
    if (now < at || now > dueAt + REMINDER_GRACE_MS) continue;
    out.push({
      key: `${q.id}@${due}`,
      title: q.name,
      body: q.tiny ? "Tiny step: " + q.tiny : `+${q.xp} XP waiting`,
    });
  }
  return out;
}

function localYmd(ts, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function advanceYmd(s, repeat) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (repeat === "daily") dt.setUTCDate(dt.getUTCDate() + 1);
  else if (repeat === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else if (repeat === "monthly") dt.setUTCMonth(dt.getUTCMonth() + 1);
  else if (repeat === "weekdays") { do dt.setUTCDate(dt.getUTCDate() + 1); while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6); }
  else dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

// Converts a wall-clock time in an IANA zone to a UTC timestamp (handles DST).
export function zonedTimeToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffset(guess, tz);
  let t = guess - off1;
  const off2 = tzOffset(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}
function tzOffset(ts, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts)).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/* ---------------- Web Push (VAPID, empty payload) ---------------- */

async function pushUser(env, userId) {
  const { results: subs } = await env.DB.prepare("SELECT endpoint FROM subs WHERE user_id = ?").bind(userId).all();
  let ok = 0;
  for (const { endpoint } of subs) {
    try {
      const res = await sendPush(env, endpoint);
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(endpoint).run();
      } else if (res.ok) ok++;
      else console.warn("push failed", res.status, await res.text());
    } catch (e) { console.warn("push error", e); }
  }
  return ok;
}

async function sendPush(env, endpoint) {
  const jwt = await vapidJwt(env, new URL(endpoint).origin);
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      TTL: "86400",
      Urgency: "high",
    },
    body: "",
  });
}

let keyCache;
export async function vapidJwt(env, aud) {
  if (!keyCache) {
    keyCache = await crypto.subtle.importKey(
      "jwk", { ...JSON.parse(env.VAPID_PRIVATE_JWK), ext: true },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
    );
  }
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT,
  })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyCache, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64u(new Uint8Array(sig))}`;
}
function b64u(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
