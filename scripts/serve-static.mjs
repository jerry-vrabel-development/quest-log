// Minimal static server for the PWA, used by the end-to-end tests (no Worker, no sync).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".webm": "video/webm",
  ".gif": "image/gif",
};

/** The "/*" rule from public/_headers, so every e2e test runs under the real security headers. */
async function loadHeaders() {
  try {
    const text = await readFile(join(ROOT, "_headers"), "utf8");
    const out = {};
    let inAll = false;
    for (const line of text.split("\n")) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      if (!/^\s/.test(line)) {
        inAll = line.trim() === "/*";
        continue;
      }
      const i = line.indexOf(":");
      if (inAll && i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}
const HEADERS = await loadHeaders();
// HSTS means nothing over plain-http localhost; leave it out here.
delete HEADERS["Strict-Transport-Security"];

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, path.endsWith("/") ? path + "index.html" : path);
  if (path === "/_headers") {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...HEADERS, "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`serving public/ on http://localhost:${PORT}`));
