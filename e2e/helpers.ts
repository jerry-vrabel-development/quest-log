// Shared steps for the end-to-end tests.
import { expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Logs a check-in through the 📝 Log button: a mood ("6 out of 10, Okay"), and optionally more. */
export async function logMood(
  page: Page,
  mood: string,
  { note, steps = [], sleep, picture }: { note?: string; steps?: string[]; sleep?: string; picture?: string } = {},
) {
  await page.getByRole("button", { name: "📝 Log", exact: true }).click();
  const dlg = page.locator("#logDialog");
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: mood }).click();
  if (steps.length || sleep) {
    await dlg.getByText("More: anxiety, energy, body, focus, sleep, pain").click();
    for (const s of steps) await dlg.getByRole("button", { name: s }).click();
    if (sleep) await dlg.getByLabel(/^Sleep/).fill(sleep);
  }
  if (note) await dlg.getByLabel(/^Note/).fill(note);
  if (picture) {
    await dlg.getByLabel(/^Picture or GIF/).setInputFiles(picture);
    await expect(dlg.locator("#logPreview")).toBeVisible();
  }
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dlg).toBeHidden();
}

/**
 * A private copy of the static server on its own port. Going offline means stopping it: Playwright's
 * setOffline doesn't cover requests the service worker makes in Chromium, so it can't prove the cache works.
 */
export async function startServer(port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
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

export async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill();
  });
}

/** Waits until the service worker controls the page and has cached the app shell. */
export async function waitForOfflineReady(page: Page): Promise<string> {
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
