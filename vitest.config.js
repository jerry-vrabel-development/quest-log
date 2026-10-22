import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The OAuth library imports the Workers runtime module; tests run in Node, so stub it.
    alias: { "cloudflare:workers": new URL("./test/helpers/cloudflare-workers-stub.js", import.meta.url).pathname },
  },
  test: {
    include: ["test/**/*.test.js"],
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
    coverage: { include: ["public/js/core/**", "src/**"], reporter: ["text", "html"] },
  },
});
