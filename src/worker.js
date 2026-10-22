// Quest Log: Cloudflare Worker entry point.
//
//   /            static PWA (public/)
//   /api/*       sync, push subscriptions, notification outbox      → api.js
//   /authorize   OAuth consent page for the Claude connector         → authorize.js
//   /mcp         MCP server, behind OAuth 2.1                         → mcp/server.js
//   cron         reminder push every 5 minutes                       → reminders.js
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { handleApi } from "./api.js";
import { handleAuthorize } from "./authorize.js";
import { handleMcp } from "./mcp/server.js";
import { runReminders } from "./reminders.js";

/** Everything that isn't the OAuth-protected /mcp route. */
export const app = {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === "/authorize") return handleAuthorize(req, env);
    if (pathname.startsWith("/api/")) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  },
};

export const OAUTH_OPTIONS = {
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["quests", "offline_access"],
  requiredScopes: ["quests"],
  refreshTokenIdleTTL: 60 * 86400, // stay connected while in use
};

// One provider per origin, so the connector works on both workers.dev and a custom domain.
const providers = new Map();
export function providerFor(origin) {
  if (!providers.has(origin)) {
    providers.set(
      origin,
      new OAuthProvider({
        ...OAUTH_OPTIONS,
        apiHandler: { fetch: handleMcp },
        defaultHandler: app,
        resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "Quest Log" },
      }),
    );
  }
  return providers.get(origin);
}

export default {
  fetch(req, env, ctx) {
    return providerFor(new URL(req.url).origin).fetch(req, env, ctx);
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, Date.now()));
  },
};
