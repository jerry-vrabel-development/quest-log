import type { Limiter } from "../../src/worker/limits";

/** A stand-in for Cloudflare's rate limiter: allows `max` calls per key, and records the keys it saw. */
export function createLimiter(max: number): Limiter & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= max };
    },
  };
}
