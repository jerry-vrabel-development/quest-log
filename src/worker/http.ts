// Small HTTP helpers shared by the API, the consent page and the MCP server.

export const SYNC_CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY" },
  });
}

/** SHA-256 as lowercase hex. The server identifies users by the hash of their sync code. */
export async function sha256Hex(text: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The user id for a sync code, or null if it isn't shaped like one. */
export async function userIdForCode(code: string): Promise<string | null> {
  return SYNC_CODE_RE.test(code) ? sha256Hex(code) : null;
}

/** The user id from an `Authorization: Bearer <sync code>` header. */
export async function userIdFromRequest(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get("Authorization") || "");
  return m ? userIdForCode(m[1]) : null;
}

/** Parses a JSON body, returning undefined instead of throwing on bad input. */
export async function readJson<T = unknown>(req: Request): Promise<T | undefined> {
  try {
    return await req.json<T>();
  } catch {
    return undefined;
  }
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
