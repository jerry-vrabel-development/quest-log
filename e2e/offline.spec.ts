// The service worker (#97): offline use, the update flow and push. Every other spec blocks the
// service worker for stable tests, so this is the one place those promises are checked.
import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

test.use({ serviceWorkers: "allow" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
    if (localStorage.getItem("quest-log-welcome") === null) localStorage.setItem("quest-log-welcome", "0");
  });
});

/**
 * A private copy of the static server on its own port. Going offline means stopping it: Playwright's
 * setOffline doesn't cover requests the service worker makes in Chromium, so it can't prove the cache works.
 */
async function startServer(port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
  const server = spawn(process.execPath, [fileURLToPath(new URL("../scripts/serve-static.mjs", import.meta.url))], {
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    server.stdout.on("data", () => resolve());
    server.on("exit", () => reject(new Error("static server exited")));
  });
  return server;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill();
  });
}

/** Waits until the service worker controls the page and has cached the app shell. */
async function waitForOfflineReady(page: Page): Promise<string> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      });
    }
  });
  let shell = "";
  await expect
    .poll(async () => {
      shell = await page.evaluate(async () => {
        const keys = await caches.keys();
        return keys.find((k) => k.startsWith("quest-log-") && k !== "quest-log-config") ?? "";
      });
      return shell;
    })
    .not.toBe("");
  return shell;
}

test("offline: the app loads from the cache and a quest can still be checked off", async ({ page }, info) => {
  // One port per project, so the projects can run side by side.
  const port = 4200 + info.parallelIndex;
  const origin = `http://localhost:${String(port)}`;
  const server = await startServer(port);
  try {
    await page.goto(origin + "/");
    await waitForOfflineReady(page);

    await stopServer(server); // offline: nothing answers on this port any more
    await page.reload();

    await expect(page.getByRole("heading", { name: "Quest Log", level: 1 })).toBeVisible();
    await page.getByLabel("Complete Check off this quest").click();
    await page.getByRole("button", { name: "Collect" }).click();
    await expect(page.locator(".q", { hasText: "Check off this quest" })).toHaveCount(0);

    // The self-hosted fonts come from the cache too, so the offline app looks like the online one.
    const fontsOk = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px "Space Grotesk"');
    });
    expect(fontsOk).toBe(true);
  } finally {
    await stopServer(server);
  }
});

test("update: a new build takes over and the old cache is deleted", async ({ page, context }) => {
  await page.goto("/");
  const oldCache = await waitForOfflineReady(page);
  expect(oldCache).not.toBe("quest-log-next-build");

  // Ship a "new build": the test server swaps the build id in sw.js when this cookie is set.
  await context.addCookies([{ name: "sw-build", value: "next-build", url: "http://localhost:4173" }]);
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  });

  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k !== "quest-log-config").sort()))
    .toEqual(["quest-log-next-build"]);

  // The page is now controlled by the new worker.
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain("/sw.js");
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
