// Quest Log service worker: offline app shell + notification clicks.
const CACHE = "quest-log-v7";
const CONFIG = "quest-log-config";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CONFIG).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
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
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    }).catch(() => hit)));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});

// Server push: the push itself is empty, so fetch the waiting notifications.
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const cfg = await (await caches.open(CONFIG)).match("/__config");
      const { code } = cfg ? await cfg.json() : {};
      if (code) {
        const res = await fetch("/api/outbox", { headers: { Authorization: "Bearer " + code }, cache: "no-store" });
        if (res.ok) items = (await res.json()).items || [];
      }
    } catch (err) {}
    if (!items.length) items = [{ title: "Quest Log", body: "You have a quest waiting.", tag: "quest-log" }];
    await Promise.all(items.map((it) => self.registration.showNotification(it.title, {
      body: it.body, tag: it.tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    })));
  })());
});
