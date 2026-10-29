// The OAuth layer in front of /mcp, exercised end to end through the real Worker entry point:
// discovery → client registration → consent with the sync code → token → authenticated MCP call.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/worker";
import { createD1 } from "../helpers/d1";
import { CODE, emptyState, quest, seedUser } from "../helpers/fixtures";
import { body } from "../helpers/http";
import { createLimiter } from "../helpers/limits";

const ORIGIN = "https://quests.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

/** An in-memory stand-in for Workers KV, covering the calls the OAuth library makes. */
function memoryKV(): KVNamespace {
  const m = new Map<string, string>();
  const kv = {
    async get(k: string, opts?: string | { type?: string }) {
      const v = m.get(k);
      const type = typeof opts === "string" ? opts : opts?.type;
      return (
        v === undefined ? null
        : type === "json" ? JSON.parse(v)
        : v
      );
    },
    async put(k: string, v: string) {
      m.set(k, v);
    },
    async delete(k: string) {
      m.delete(k);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
  return kv as unknown as KVNamespace;
}

let env: Env;
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
type FetchArgs = Parameters<typeof worker.fetch>;
const fetchW = async (path: string, init?: RequestInit): Promise<Response> =>
  await worker.fetch(new Request(ORIGIN + path, init) as FetchArgs[0], env, ctx);

beforeEach(async () => {
  env = {
    DB: createD1(),
    OAUTH_KV: memoryKV(),
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
  } as Partial<Env> as Env;
  await seedUser(env.DB, emptyState({ quests: [quest(1, { name: "Walk Bash" })] }));
});

const b64url = (bytes: Uint8Array) =>
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
    const meta = await body(await fetchW("/.well-known/oauth-protected-resource/mcp"));
    expect(meta).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
  });

  it("completes the full authorization code + PKCE flow and calls a tool", async () => {
    const as = await body(await fetchW("/.well-known/oauth-authorization-server"));
    expect(as.code_challenge_methods_supported).toContain("S256");

    const client = await body(
      await fetchW("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Test Client",
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: "none",
        }),
      }),
    );

    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const authorizeUrl = `/authorize?${String(
      new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        scope: "quests",
        state: "xyz",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: `${ORIGIN}/mcp`,
      }),
    )}`;

    /** Loads the consent page and returns its single-use handle and binding cookie. */
    const openConsent = async () => {
      const page = await fetchW(authorizeUrl);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Connect Test Client to Quest Log?");
      const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? "";
      const cookie = page.headers.get("set-cookie")?.split(";")[0];
      return { handle, cookie };
    };
    const approve = ({ handle, cookie }: { handle: string; cookie?: string }, code: string) =>
      fetchW("/authorize", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams({ handle, decision: "approve", code, scope: "quests" }),
        redirect: "manual",
      });

    // a wrong sync code is refused (and burns the single-use handle)
    expect((await approve(await openConsent(), "z".repeat(43))).status).toBe(400);

    // start again with the right one
    const ok = await approve(await openConsent(), CODE);
    expect(ok.status).toBe(302);
    const location = new URL(ok.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz");

    const token = await body(
      await fetchW("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: location.searchParams.get("code") ?? "",
          redirect_uri: REDIRECT,
          client_id: client.client_id,
          code_verifier: verifier,
          resource: `${ORIGIN}/mcp`,
        }),
      }),
    );
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
    expect((await body(res)).result.content[0].text).toContain("#1 Walk Bash");

    // the connector has a per-account limit (#64)
    env.MCP_LIMIT = createLimiter(0);
    const limited = await fetchW("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("passes non-MCP routes through to the app", async () => {
    expect(await (await fetchW("/")).text()).toBe("asset");
    expect((await fetchW("/api/state")).status).toBe(401);
  });
});
