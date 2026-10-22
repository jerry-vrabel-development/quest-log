// Builds the browser app: src/client → public/js/app.js, and the service worker → public/sw.js.
// The service worker's cache name includes a hash of the shell, so every deploy refreshes it.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const root = new URL("../", import.meta.url).pathname;
const watch = process.argv.includes("--watch");
const common = { bundle: true, format: "esm", target: "es2022", sourcemap: true, minify: !watch, logLevel: "info" };

const app = { ...common, entryPoints: [root + "src/client/main.ts"], outfile: root + "public/js/app.js" };

async function buildId() {
  const files = ["public/js/app.js", "public/index.html", "public/styles.css", "public/manifest.webmanifest"];
  const h = createHash("sha256");
  for (const f of files) h.update(await readFile(root + f));
  return h.digest("hex").slice(0, 12);
}
const sw = async () => ({
  ...common,
  format: "iife",
  entryPoints: [root + "src/client/sw.ts"],
  outfile: root + "public/sw.js",
  define: { __BUILD_ID__: JSON.stringify(watch ? "dev" : await buildId()) },
});

if (watch) {
  await (await esbuild.context(app)).watch();
  await (await esbuild.context(await sw())).watch();
} else {
  await esbuild.build(app);
  await esbuild.build(await sw());
}
