import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The OAuth library imports the Workers runtime module; tests run in Node, so stub it.
    alias: { "cloudflare:workers": new URL("./test/helpers/cloudflare-workers-stub.ts", import.meta.url).pathname },
  },
  test: {
    include: ["test/**/*.test.ts"],
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
    coverage: { include: ["src/core/**", "src/worker/**"], reporter: ["text", "html"] },
  },
});
