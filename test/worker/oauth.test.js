// The OAuth layer in front of /mcp, exercised end to end through the real Worker entry point:
// discovery → client registration → consent with the sync code → token → authenticated MCP call.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker.js";
import { createD1 } from "../helpers/d1.js";
import { CODE, emptyState, quest, seedUser } from "../helpers/fixtures.js";

const ORIGIN = "https://quests.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function memoryKV() {
  const m = new Map();
  return {
    async get(k, opts) {
      const v = m.get(k);
      const type = typeof opts === "string" ? opts : opts?.type;
      return (
        v === undefined ? null
        : type === "json" ? JSON.parse(v)
        : v
      );
    },
    async put(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    async list({ prefix = "" } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

let env;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const fetchW = (path, init) => worker.fetch(new Request(ORIGIN + path, init), env, ctx);

beforeEach(async () => {
  env = { DB: createD1(), OAUTH_KV: memoryKV(), ASSETS: { fetch: () => new Response("asset") } };
  await seedUser(env.DB, emptyState({ quests: [quest(1, { name: "Walk Bash" })] }));
});

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

describe("OAuth-protected MCP endpoint", () => {
  it("challenges unauthenticated calls and points to the resource metadata", async () => {
    const res = await fetchW("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource`,
    );
    const meta = await (await fetchW("/.well-known/oauth-protected-resource/mcp")).json();
    expect(meta).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
  });

  it("completes the full authorization code + PKCE flow and calls a tool", async () => {
    const as = await (await fetchW("/.well-known/oauth-authorization-server")).json();
    expect(as.code_challenge_methods_supported).toContain("S256");

    const client = await (
      await fetchW("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Test Client",
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: "none",
        }),
      })
    ).json();

    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const q = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      scope: "quests",
      state: "xyz",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${ORIGIN}/mcp`,
    });

    // consent page
    const page = await fetchW(`/authorize?${q}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Connect Test Client to Quest Log?");
    const handle = /name="handle" value="([^"]+)"/.exec(html)[1];
    const cookie = page.headers.get("set-cookie")?.split(";")[0];

    const consent = (code) =>
      fetchW("/authorize", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams({ handle, decision: "approve", code, scope: "quests" }),
        redirect: "manual",
      });

    // wrong sync code is refused
    expect((await consent("z".repeat(43))).status).toBe(400);

    // a wrong code burns the single-use handle, so start again and use the right one
    const page2 = await fetchW(`/authorize?${q}`);
    const html2 = await page2.text();
    const handle2 = /name="handle" value="([^"]+)"/.exec(html2)[1];
    const cookie2 = page2.headers.get("set-cookie")?.split(";")[0];
    const ok = await fetchW("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie2 ? { cookie: cookie2 } : {}) },
      body: new URLSearchParams({ handle: handle2, decision: "approve", code: CODE, scope: "quests" }),
      redirect: "manual",
    });
    expect(ok.status).toBe(302);
    const location = new URL(ok.headers.get("location"));
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz");

    const token = await (
      await fetchW("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: location.searchParams.get("code"),
          redirect_uri: REDIRECT,
          client_id: client.client_id,
          code_verifier: verifier,
          resource: `${ORIGIN}/mcp`,
        }),
      })
    ).json();
    expect(token.token_type.toLowerCase()).toBe("bearer");

    const res = await fetchW("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_quests", arguments: { view: "all" } },
      }),
    });
    expect((await res.json()).result.content[0].text).toContain("#1 Walk Bash");
  });

  it("passes non-MCP routes through to the app", async () => {
    expect(await (await fetchW("/")).text()).toBe("asset");
    expect((await fetchW("/api/state")).status).toBe(401);
  });
});
