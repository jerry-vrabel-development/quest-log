// Data access for D1. Every SQL statement the Worker runs lives here.
import type { State } from "../core/types";

export const DEFAULT_TZ = "America/Chicago";
const OUTBOX_KEEP_MS = 7 * 86_400_000;
const SENT_KEEP_MS = 30 * 86_400_000;

interface UserRow {
  id: string;
  state: string;
  tz: string | null;
  updated_at: number;
}

export interface Notice {
  title: string;
  body: string;
  tag: string;
}

export interface StoredUser {
  state: State;
  updatedAt: number;
  tz: string;
}

/* ---------- users ---------- */

export async function userExists(db: D1Database, userId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(userId).first());
}

export async function getUser(db: D1Database, userId: string): Promise<StoredUser | null> {
  const row = await db
    .prepare("SELECT state, updated_at, tz FROM users WHERE id = ?")
    .bind(userId)
    .first<Omit<UserRow, "id">>();
  return row ? { state: JSON.parse(row.state) as State, updatedAt: row.updated_at, tz: row.tz || DEFAULT_TZ } : null;
}

export async function getUpdatedAt(db: D1Database, userId: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT updated_at FROM users WHERE id = ?")
    .bind(userId)
    .first<Pick<UserRow, "updated_at">>();
  return row ? row.updated_at : null;
}

export async function putUser(
  db: D1Database,
  userId: string,
  state: unknown,
  tz: string,
  updatedAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, state, tz, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET state = ?2, tz = ?3, updated_at = ?4`,
    )
    .bind(userId, JSON.stringify(state), tz, updatedAt)
    .run();
}

/** Users with at least one push subscription (the only ones the cron needs to look at). */
export async function usersWithPush(db: D1Database): Promise<Omit<UserRow, "updated_at">[]> {
  const { results } = await db
    .prepare("SELECT u.id, u.state, u.tz FROM users u WHERE EXISTS (SELECT 1 FROM subs s WHERE s.user_id = u.id)")
    .all<Omit<UserRow, "updated_at">>();
  return results;
}

/* ---------- push subscriptions ---------- */

export async function addSub(db: D1Database, userId: string, endpoint: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subs (endpoint, user_id, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = ?2`,
    )
    .bind(endpoint, userId, now)
    .run();
}

export async function removeSub(db: D1Database, userId: string, endpoint: string): Promise<void> {
  await db.prepare("DELETE FROM subs WHERE endpoint = ? AND user_id = ?").bind(endpoint, userId).run();
}

export async function dropSub(db: D1Database, endpoint: string): Promise<void> {
  await db.prepare("DELETE FROM subs WHERE endpoint = ?").bind(endpoint).run();
}

export async function subsFor(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT endpoint FROM subs WHERE user_id = ?")
    .bind(userId)
    .all<{ endpoint: string }>();
  return results.map((r) => r.endpoint);
}

/* ---------- reminders sent + outbox ---------- */

/** Records that a reminder went out. Returns false if it was already recorded. */
export async function markSent(db: D1Database, userId: string, key: string, now: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT OR IGNORE INTO sent (user_id, key, at) VALUES (?, ?, ?)")
    .bind(userId, key, now)
    .run();
  return r.meta.changes > 0;
}

export async function pruneSent(db: D1Database, now: number): Promise<void> {
  await db
    .prepare("DELETE FROM sent WHERE at < ?")
    .bind(now - SENT_KEEP_MS)
    .run();
}

export async function enqueue(
  db: D1Database,
  userId: string,
  { title, body, tag }: Notice,
  now: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO outbox (user_id, title, body, tag, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, title, body, tag, now)
    .run();
}

/** Takes up to 10 waiting notifications, marks them delivered and prunes old rows. */
export async function takeOutbox(db: D1Database, userId: string, now: number): Promise<(Notice & { id: number })[]> {
  const { results } = await db
    .prepare("SELECT id, title, body, tag FROM outbox WHERE user_id = ? AND delivered = 0 ORDER BY id LIMIT 10")
    .bind(userId)
    .all<Notice & { id: number }>();
  if (results.length) {
    await db
      .prepare(`UPDATE outbox SET delivered = 1 WHERE user_id = ? AND id IN (${results.map(() => "?").join(",")})`)
      .bind(userId, ...results.map((r) => r.id))
      .run();
  }
  await db
    .prepare("DELETE FROM outbox WHERE created_at < ?")
    .bind(now - OUTBOX_KEEP_MS)
    .run();
  return results;
}
