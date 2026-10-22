// Quest Log: Cloudflare Worker entry point.
//
//   /            static PWA (public/, built from src/client)
//   /api/*       sync, push subscriptions, notification outbox      → api.ts
//   /authorize   OAuth consent page for the Claude connector         → authorize.ts
//   /mcp         MCP server, behind OAuth 2.1                         → mcp/server.ts
//   cron         reminder push every 5 minutes                       → reminders.ts
import { OAuthProvider, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { handleApi } from "./api";
import { handleAuthorize, type GrantProps } from "./authorize";
import { handleMcp } from "./mcp/server";
import { runReminders } from "./reminders";

/** Everything that isn't the OAuth-protected /mcp route. */
export const app = {
  async fetch(req: Request, env: Env): Promise<Response> {
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
} satisfies Partial<OAuthProviderOptions<Env>>;

// One provider per origin, so the connector works on both workers.dev and a custom domain.
const providers = new Map<string, OAuthProvider<Env>>();
export function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      ...OAUTH_OPTIONS,
      apiHandler: {
        fetch: (req: Request, env: Env, ctx: ExecutionContext & { props?: GrantProps }) => handleMcp(req, env, ctx),
      },
      defaultHandler: app,
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "Quest Log" },
    } as OAuthProviderOptions<Env>);
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch(req, env, ctx) {
    return providerFor(new URL(req.url).origin).fetch(req, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runReminders(env, Date.now()));
  },
} satisfies ExportedHandler<Env>;
