// Rate limits (#64), with Cloudflare's Rate Limiting binding. Sync codes are 256-bit random, so
// this isn't about guessing; it's about a buggy client or an abuser running up Worker, D1 and R2
// costs. Limits are per Cloudflare location and approximate, which is fine for that.
//
//   API_LIMIT    /api/*                 120 per minute per account
//   MEDIA_LIMIT  PUT /api/media/:id      30 per minute per account (on top of API_LIMIT)
//   MCP_LIMIT    /mcp                    60 per minute per connected account
//   AUTH_LIMIT   /authorize POST, /oauth/register   10 per minute per IP
import { json } from "./http";

/** The binding's shape (Cloudflare's RateLimit), so tests can pass a fake. */
export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Optional, so environments without the bindings (local tests) simply aren't limited. */
export type LimitEnv = Partial<Record<"API_LIMIT" | "MEDIA_LIMIT" | "MCP_LIMIT" | "AUTH_LIMIT", Limiter>>;

/** Seconds a client should wait after a 429: the limits use one-minute windows. */
export const RETRY_AFTER_S = 60;

/** True when this key is over the limit. Fails open: if the limiter errors, the request goes through. */
export async function overLimit(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false;
  }
}

export function tooMany(): Response {
  const res = json({ error: "rate_limited", retryAfter: RETRY_AFTER_S }, 429);
  res.headers.set("retry-after", String(RETRY_AFTER_S));
  return res;
}

/** The caller's IP, for limits on routes without an account yet. */
export const clientIp = (req: Request): string => req.headers.get("cf-connecting-ip") ?? "unknown";
