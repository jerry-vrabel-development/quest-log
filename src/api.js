// The app's REST API: state sync, push subscriptions and the notification outbox.
// Authenticated by the sync code as a bearer token; the server only stores its hash.
import { isValidTimeZone } from "../public/js/core/dates.js";
import { DEFAULT_TZ, addSub, enqueue, getUpdatedAt, getUser, putUser, removeSub, takeOutbox } from "./db.js";
import { json, readJson, userIdFromRequest } from "./http.js";
import { pushUser } from "./push.js";

export const MAX_STATE_BYTES = 1_000_000;

const isPushEndpoint = (s) => {
  try {
    return typeof s === "string" && s.length < 1000 && new URL(s).protocol === "https:";
  } catch {
    return false;
  }
};

const routes = {
  async "GET /api/state"(req, env, userId) {
    const user = await getUser(env.DB, userId);
    return user ? json(user) : json({ error: "not_found" }, 404);
  },

  async "PUT /api/state"(req, env, userId) {
    const text = await req.text();
    if (text.length > MAX_STATE_BYTES) return json({ error: "too_large" }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad_json" }, 400);
    }
    if (!body || typeof body.state !== "object" || !Array.isArray(body.state?.quests))
      return json({ error: "bad_state" }, 400);
    const updatedAt = Number(body.updatedAt) || Date.now();
    const tz = isValidTimeZone(body.tz) ? body.tz : DEFAULT_TZ;
    const existing = await getUpdatedAt(env.DB, userId);
    if (existing !== null && existing > updatedAt && !body.force) {
      // another device saved something newer: the client should pull first
      return json({ error: "conflict", updatedAt: existing }, 409);
    }
    await putUser(env.DB, userId, body.state, tz, updatedAt);
    return json({ ok: true, updatedAt });
  },

  async "POST /api/subscribe"(req, env, userId) {
    const { endpoint } = (await readJson(req)) || {};
    if (!isPushEndpoint(endpoint)) return json({ error: "bad_endpoint" }, 400);
    await addSub(env.DB, userId, endpoint, Date.now());
    return json({ ok: true });
  },

  async "DELETE /api/subscribe"(req, env, userId) {
    const { endpoint } = (await readJson(req)) || {};
    if (typeof endpoint !== "string") return json({ error: "bad_endpoint" }, 400);
    await removeSub(env.DB, userId, endpoint);
    return json({ ok: true });
  },

  async "GET /api/outbox"(req, env, userId) {
    return json({ items: await takeOutbox(env.DB, userId, Date.now()) });
  },

  async "POST /api/test-push"(req, env, userId, deps) {
    const now = Date.now();
    await enqueue(
      env.DB,
      userId,
      { title: "Quest Log test", body: "Push reminders are working. Go get some loot.", tag: "test-" + now },
      now,
    );
    return json({ ok: true, sent: await deps.push(env, userId) });
  },
};

/** Handles /api/*. `deps` lets tests swap out the network-facing push sender. */
export async function handleApi(req, env, deps = { push: pushUser }) {
  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname}`;
  if (route === "GET /api/config") return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY });
  const handler = routes[route];
  if (!handler) return json({ error: "not_found" }, 404);
  const userId = await userIdFromRequest(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  try {
    return await handler(req, env, userId, deps);
  } catch (err) {
    console.error(err);
    return json({ error: "server_error" }, 500);
  }
}
