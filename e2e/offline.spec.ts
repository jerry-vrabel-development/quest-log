// The service worker (#97): offline use and the update flow (push is in push.spec.ts). Every other
// spec blocks the service worker for stable tests, so this is where those promises are checked.
import { startServer, stopServer, waitForOfflineReady } from "./helpers";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
    if (localStorage.getItem("quest-log-welcome") === null) localStorage.setItem("quest-log-welcome", "0");
  });
});

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
