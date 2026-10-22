// Bindings that `wrangler types` can't see: secrets, and what the OAuth provider injects.
// The rest of Env (D1, KV, assets, vars) is generated into worker-configuration.d.ts.
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    /** ES256 private key (JWK JSON) for signing VAPID push requests. Set with `wrangler secret put`. */
    VAPID_PRIVATE_JWK: string;
    /** Added to env by the OAuth provider for the default (non-API) handler. */
    OAUTH_PROVIDER: OAuthHelpers;
  }
}
