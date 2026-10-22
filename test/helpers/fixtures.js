import { freshState } from "../../public/js/core/state.js";
import { sha256Hex } from "../../src/http.js";

export const CODE = "a".repeat(43);
export const OTHER_CODE = "b".repeat(43);

/** A Quest Log state with no seed quests, plus any overrides. */
export function emptyState(overrides = {}) {
  return { ...freshState("2026-10-22"), quests: [], nextId: 1, ...overrides };
}

/** A minimal valid quest. */
export function quest(id, fields = {}) {
  return {
    id,
    name: `Quest ${id}`,
    tiny: "",
    g: "Test",
    xp: 10,
    due: "",
    time: "",
    repeat: "none",
    remind: 0,
    done: false,
    doneAt: null,
    count: 0,
    ...fields,
  };
}

/** Inserts a user row directly and returns its id (the hash of the code). */
export async function seedUser(db, state, { code = CODE, tz = "America/Chicago", updatedAt = 1000 } = {}) {
  const id = await sha256Hex(code);
  await db
    .prepare("INSERT INTO users (id, state, tz, updated_at) VALUES (?, ?, ?, ?)")
    .bind(id, JSON.stringify(state), tz, updatedAt)
    .run();
  return id;
}

/** Deterministic PRNG (mulberry32) so loot tests are repeatable. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns the given values in order, then repeats the last one. */
export const sequence =
  (...values) =>
  () =>
    values.length > 1 ? values.shift() : values[0];
