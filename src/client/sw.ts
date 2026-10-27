// Quest Log service worker: offline app shell, notification clicks, and server push.
export type {}; // a module, so the `self` declaration below can narrow the WebWorker lib type
declare const self: ServiceWorkerGlobalScope;
/** Content hash of the shell, injected at build time; a new build means a new cache. */
declare const __BUILD_ID__: string;

const CACHE = `quest-log-${__BUILD_ID__}`;
const CONFIG = "quest-log-config";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "fonts/space-grotesk-latin-400-normal.woff2",
  "fonts/space-grotesk-latin-500-normal.woff2",
  "fonts/space-grotesk-latin-700-normal.woff2",
  "fonts/jetbrains-mono-latin-500-normal.woff2",
  "manifest.webmanifest",
  "js/app.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

interface Notice {
  title: string;
  body: string;
  tag: string;
}

async function cachePut(req: Request, res: Response): Promise<void> {
  const c = await caches.open(CACHE);
  await c.put(req, res);
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CONFIG).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for the app's own files (so updates land), cache fallback when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return; // never cache the API
  if (url.origin !== location.origin) {
    // fonts etc.: cache first
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            void cachePut(req, res.clone());
            return res;
          }),
      ),
    );
    return;
  }
  e.respondWith(
    fetch(req)
      .then((res) => {
        void cachePut(req, res.clone());
        return res;
      })
      .catch(async () => (await caches.match(req)) || (await caches.match("index.html")) || Response.error()),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    }),
  );
});

// Server push: the push itself is empty, so fetch the waiting notifications.
self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      let items: Notice[] = [];
      try {
        const cfg = await (await caches.open(CONFIG)).match("/__config");
        const { code } = cfg ? ((await cfg.json()) as { code?: string }) : {};
        if (code) {
          const res = await fetch("/api/outbox", { headers: { Authorization: "Bearer " + code }, cache: "no-store" });
          if (res.ok) items = ((await res.json()) as { items?: Notice[] }).items || [];
        }
      } catch {
        // offline or server down: fall back to a generic nudge below
      }
      if (!items.length) items = [{ title: "Quest Log", body: "You have a quest waiting.", tag: "quest-log" }];
      await Promise.all(
        items.map((it) =>
          self.registration.showNotification(it.title, {
            body: it.body,
            tag: it.tag,
            icon: "icons/icon-192.png",
            badge: "icons/icon-192.png",
          }),
        ),
      );
    })(),
  );
});
