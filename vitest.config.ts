import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The OAuth library imports the Workers runtime module; tests run in Node, so stub it.
    alias: { "cloudflare:workers": new URL("./test/helpers/cloudflare-workers-stub.ts", import.meta.url).pathname },
  },
  test: {
    include: ["test/**/*.test.ts"],
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
    coverage: {
      include: ["src/core/**", "src/worker/**"],
      reporter: ["text", "html"],
      // A floor a little under today's numbers (96.8 / 89.2 / 97.5 / 97.8), so coverage can't slip unnoticed.
      // Raise it when coverage goes up; never lower it to make a PR pass.
      thresholds: { statements: 95, branches: 87, functions: 95, lines: 95 },
    },
  },
});
