// A D1-compatible database for tests, backed by Node's built-in SQLite and the real schema.sql.
// Implements the slice of the D1 API the Worker uses: prepare().bind().first() / .run() / .all().
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const SCHEMA = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");
/** node:sqlite rows have a null prototype; copy them into plain objects like D1 returns. */
const plain = <T>(row: unknown): T | null => (row ? { ...row } : null) as T | null;

export interface TestD1 {
  raw: DatabaseSync;
}

export function createD1(): D1Database & TestD1 {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async <T>() => plain<T>(db.prepare(sql).get(...args)),
    all: async <T>() => ({
      results: db
        .prepare(sql)
        .all(...args)
        .map((r) => plain<T>(r) as T),
    }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  // Only the methods above are implemented; the cast is the price of not reimplementing all of D1.
  return { prepare: (sql: string) => statement(sql), raw: db } as unknown as D1Database & TestD1;
}
