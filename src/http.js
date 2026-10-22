// Small HTTP helpers shared by the API, the consent page and the MCP server.

export const SYNC_CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY" },
  });
}

/** SHA-256 as lowercase hex. The server identifies users by the hash of their sync code. */
export async function sha256Hex(text) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The user id for a sync code, or null if it isn't shaped like one. */
export async function userIdForCode(code) {
  return SYNC_CODE_RE.test(code) ? sha256Hex(code) : null;
}

/** The user id from an `Authorization: Bearer <sync code>` header. */
export async function userIdFromRequest(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get("Authorization") || "");
  return m ? userIdForCode(m[1]) : null;
}

/** Parses a JSON body, returning undefined instead of throwing on bad input. */
export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
