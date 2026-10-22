// A D1-compatible database for tests, backed by Node's built-in SQLite and the real schema.sql.
// Implements the slice of the D1 API the Worker uses: prepare().bind().first() / .run() / .all().
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");
const plain = (row) => (row ? { ...row } : null);

export function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => plain(db.prepare(sql).get(...args)),
    all: async () => ({
      results: db
        .prepare(sql)
        .all(...args)
        .map(plain),
    }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), raw: db };
}
