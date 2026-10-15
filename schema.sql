-- Quest Log D1 schema
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,          -- SHA-256 of the sync code (the code itself is never stored)
  state      TEXT NOT NULL,             -- the app's JSON state
  tz         TEXT NOT NULL DEFAULT 'America/Chicago',
  updated_at INTEGER NOT NULL           -- ms since epoch, set by the client
);

CREATE TABLE IF NOT EXISTS subs (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subs_user ON subs(user_id);

-- reminders already sent, so each occurrence only fires once
CREATE TABLE IF NOT EXISTS sent (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- notification content waiting for the service worker to pick up
CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tag        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_user ON outbox(user_id, delivered);
