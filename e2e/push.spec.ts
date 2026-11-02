// The service worker's push handler (#97): the server's push is empty, so the worker fetches the
// waiting notifications from the outbox with the sync code and shows them.
import { startServer, stopServer, waitForOfflineReady } from "./helpers";
import { expect, test } from "@playwright/test";

test.use({
  serviceWorkers: "allow",
  // Playwright's default headless shell can't grant notification permission, so showNotification
  // always fails there. Full Chromium (in new headless mode) can. WebKit keeps its default.
  channel: async ({ browserName }, use) => {
    await use(browserName === "chromium" ? "chromium" : undefined);
  },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
    if (localStorage.getItem("quest-log-welcome") === null) localStorage.setItem("quest-log-welcome", "0");
  });
});

test("push: an empty push shows the waiting notifications from the outbox", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "Delivering a push message needs the Chrome DevTools Protocol (Chromium only)");
  const port = 4300 + info.parallelIndex;
  const origin = `http://localhost:${String(port)}`;
  const outbox = { items: [{ title: "Walk Bash", body: "Leash on, out the door", tag: "q-4" }] };
  const server = await startServer(port, { TEST_OUTBOX: JSON.stringify(outbox), TEST_SYNC_CODE: "test-sync-code" });
  try {
    await page.context().grantPermissions(["notifications"], { origin });
    const cdp = await page.context().newCDPSession(page);
    const registrationId = new Promise<string>((resolve) => {
      cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
        const reg = registrations.find((r) => r.scopeURL.startsWith(origin) && !r.isDeleted);
        if (reg) resolve(reg.registrationId);
      });
    });
    await cdp.send("ServiceWorker.enable");

    await page.goto(origin + "/");
    await waitForOfflineReady(page);
    // What the app stores when sync is on: the code the service worker uses to fetch the outbox.
    await page.evaluate(async () => {
      const c = await caches.open("quest-log-config");
      await c.put("/__config", new Response(JSON.stringify({ code: "test-sync-code" })));
    });

    // The server's push carries no payload; the worker has to fetch what to show.
    await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId: await registrationId, data: "" });

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.ready;
          return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag }));
        }),
      )
      .toEqual(outbox.items);
  } finally {
    await stopServer(server);
  }
});
