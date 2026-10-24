// Moment files backed up to R2. The device encrypts each file before upload (src/core/vault.ts),
// so this only stores and returns opaque bytes, under the account's quota.
//
//   GET    /api/media        what's backed up: ids, sizes, space used
//   PUT    /api/media/:id    store one sealed file (needs Content-Length)
//   GET    /api/media/:id    fetch it back
//   DELETE /api/media/:id    remove it
import { MEDIA_QUOTA_BYTES, SEALED_MAX_BYTES } from "../core/vault";
import { json } from "./http";

export type MediaEnv = Pick<Env, "DB" | "MEDIA">;

/** Moment ids are UUIDs; accept that shape (and nothing that could walk the key space). */
export const MEDIA_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

const key = (userId: string, id: string) => `${userId}/${id}`;

export interface MediaItem {
  id: string;
  size: number;
  at: number;
}

async function used(db: D1Database, userId: string, except: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE user_id = ? AND id != ?")
    .bind(userId, except)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listMedia(env: MediaEnv, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, size, created_at AS at FROM media WHERE user_id = ? ORDER BY created_at",
  )
    .bind(userId)
    .all<MediaItem>();
  const total = results.reduce((n, r) => n + r.size, 0);
  return json({ items: results, used: total, quota: MEDIA_QUOTA_BYTES });
}

/** Handles /api/media/:id for one user. */
export async function handleMediaItem(req: Request, env: MediaEnv, userId: string, id: string): Promise<Response> {
  if (!MEDIA_ID_RE.test(id)) return json({ error: "bad_id" }, 400);

  if (req.method === "PUT") {
    const length = Number(req.headers.get("content-length"));
    if (!req.body || !Number.isInteger(length) || length <= 0) return json({ error: "length_required" }, 411);
    if (length > SEALED_MAX_BYTES) return json({ error: "too_large" }, 413);
    if ((await used(env.DB, userId, id)) + length > MEDIA_QUOTA_BYTES) return json({ error: "quota" }, 413);
    const obj = await env.MEDIA.put(key(userId, id), req.body, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    await env.DB.prepare(
      "INSERT INTO media (user_id, id, size, created_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (user_id, id) DO UPDATE SET size = excluded.size, created_at = excluded.created_at",
    )
      .bind(userId, id, obj.size, Date.now())
      .run();
    return json({ ok: true, size: obj.size });
  }

  if (req.method === "GET") {
    const obj = await env.MEDIA.get(key(userId, id));
    if (!obj) return json({ error: "not_found" }, 404);
    return new Response(obj.body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(obj.size),
        "cache-control": "no-store",
      },
    });
  }

  if (req.method === "DELETE") {
    await env.MEDIA.delete(key(userId, id));
    await env.DB.prepare("DELETE FROM media WHERE user_id = ? AND id = ?").bind(userId, id).run();
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}
