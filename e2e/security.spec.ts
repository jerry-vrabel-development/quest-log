// Security headers: the app runs under a strict Content-Security-Policy (public/_headers), and nothing
// it does (views, dialogs, pictures, video, recording, the demo) trips it.
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { logMood } from "./helpers";

const GIF = fileURLToPath(new URL("fixtures/mood.gif", import.meta.url));
const PHOTO = fileURLToPath(new URL("fixtures/lake.png", import.meta.url));
const CLIP = fileURLToPath(new URL("fixtures/clip-2s.webm", import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    for (const k of ["quest-log-splash", "quest-log-demo:quest-log-splash"])
      if (localStorage.getItem(k) === null) localStorage.setItem(k, "0");
    const w = window as unknown as { cspViolations: string[] };
    w.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
});

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);

test("the app is served with strict security headers", async ({ page }) => {
  const res = await page.goto("/");
  const h = res?.headers() ?? {};
  expect(h["content-security-policy"]).toContain("script-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect((await page.request.get("/_headers")).status()).toBe(404);
});

test("the app loads only from its own site, fonts included", async ({ page, baseURL }) => {
  const home = new URL(baseURL ?? "http://localhost").origin;
  const elsewhere: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["http:", "https:"].includes(url.protocol)) return; // blob: and data: stay on the device
    if (url.origin !== home) elsewhere.push(r.url());
  });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`),
  );
  expect(loaded).toEqual(expect.arrayContaining(["Space Grotesk 400", "JetBrains Mono 500"]));
  expect(elsewhere).toEqual([]);
  const csp = (await page.request.get("/")).headers()["content-security-policy"];
  expect(csp).toContain("font-src 'self'");
  expect(csp).not.toContain("https:");
});

test("nothing the app does breaks its Content-Security-Policy", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Complete Check off this quest").click(); // chest, confetti
  await page.getByRole("button", { name: "Collect" }).click();
  await logMood(page, "6 out of 10, Okay", { picture: GIF, steps: ["Energy: Good"] });
  await page.getByRole("button", { name: "Collect" }).click();
  for (const view of ["Upcoming", "All", "Loot", "Journey"]) await page.getByRole("tab", { name: view }).click();

  await page.getByRole("button", { name: "Add a moment" }).click();
  const dlg = page.locator("#momentDialog");
  await dlg.getByLabel("Photo", { exact: true }).setInputFiles(PHOTO);
  await expect(dlg.locator("#momentPreview")).toBeVisible();
  await dlg.getByLabel("🎬 Video").check();
  await dlg.getByLabel(/^Video/).setInputFiles(CLIP);
  await expect(dlg.locator("#momentVideoPreview")).toBeVisible();
  await dlg.getByLabel("🎙️ Recording").check();
  await dlg.locator("#recordBtn").click();
  await page.waitForTimeout(600);
  await dlg.locator("#recordBtn").click();
  await expect(dlg.locator("#recordPreview")).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "📤 Share how I'm doing" }).click();
  await page.locator("#shareDialog").getByRole("button", { name: "Close" }).click();
  await page.locator("#freeze").click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.keyboard.press("Escape");

  await page.goto("/?demo"); // the banner and Reset
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.locator("#lvl")).toHaveText("Level 1");

  expect(await violations(page)).toEqual([]);
});

test("the privacy page is linked from Settings, readable, and passes axe", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Read" }).click();
  await expect(page).toHaveTitle("Privacy · Quest Log");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
  await expect(page.locator("main")).toContainText("encrypted on your device");
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const { violations: axe } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(axe.map((v) => v.id)).toEqual([]);
  expect(await violations(page)).toEqual([]);
  await page.getByRole("link", { name: "← Back to Quest Log" }).click();
  await expect(page.getByRole("tab", { name: "Now" })).toBeVisible();
});
