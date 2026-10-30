// The demo (?demo): a fresh start to try, sandboxed from real data and from the server.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    // Skip the opening screen in both the real app and the demo.
    for (const k of ["quest-log-splash", "quest-log-demo:quest-log-splash", "quest-log-welcome"])
      if (localStorage.getItem(k) === null) localStorage.setItem(k, "0");
  });
});

/** Fails the test on any request to the server: the demo must never call /api. */
async function noServer(page: Page) {
  const calls: string[] = [];
  await page.route("**/api/**", (r) => {
    calls.push(r.request().url());
    return r.abort();
  });
  return calls;
}

test("starts at zero: level 1, nothing logged, the starter quests, and passes axe", async ({ page }) => {
  const calls = await noServer(page);
  await page.goto("/?demo");
  await expect(page).toHaveTitle("Quest Log · Demo");
  await expect(page.getByRole("complementary", { name: "Demo" })).toContainText(
    "a fresh start to play with, kept in this browser only",
  );
  await expect(page.locator("#lvl")).toHaveText("Level 1");
  await expect(page.locator("#xp")).toContainText("0 XP");
  await expect(page.getByLabel("Complete Check off this quest")).toBeVisible();
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect(page.locator(".moments img")).toHaveCount(0);
  await expect(page.locator(".log li")).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(calls).toEqual([]);
});

test("never touches the real app's data, and Leave demo goes back to it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Complete Check off this quest").click(); // real progress
  await page.getByRole("button", { name: "Collect" }).click();
  const real = await page.evaluate(() => localStorage.getItem("quest-log-v2"));
  expect(real).toContain("Check off this quest");

  const calls = await noServer(page);
  await page.goto("/?demo");
  await page.getByLabel("Complete Check off this quest").click();
  await page.getByRole("button", { name: "Collect" }).click(); // close the chest, as above
  await expect(page.locator("#syncBox")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("quest-log-v2"))).toBe(real); // untouched
  expect(calls).toEqual([]);

  await page.getByRole("link", { name: "Leave demo" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("complementary", { name: "Demo" })).toHaveCount(0);
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next"); // the real progress, as it was
});

test("keeps your demo changes across reloads, and Reset starts over from level 1", async ({ page }) => {
  await noServer(page);
  await page.goto("/?demo");
  const xp = page.locator("#xp");
  const before = await xp.textContent();
  await page.getByLabel("Complete Check off this quest").click();
  await expect(xp).not.toHaveText(before ?? "");
  const after = await xp.textContent();
  await page.reload();
  await expect(xp).toHaveText(after ?? "");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(xp).toHaveText(before ?? "");
  await expect(page.locator("#lvl")).toHaveText("Level 1");
  await expect(page.getByLabel("Complete Check off this quest")).toBeVisible(); // open again
});

test("the banner can be closed, stays closed, and Settings still has Reset and Leave", async ({ page }) => {
  await noServer(page);
  await page.goto("/?demo");
  const banner = page.getByRole("complementary", { name: "Demo" });
  await page.getByRole("button", { name: "Close the demo banner" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#lvl")).toHaveText("Level 1");
  await expect(banner).toHaveCount(0); // stays closed

  await page.locator("#settingsBtn").click();
  await expect(page.locator("#demoRow")).toContainText("Kept in this browser only");
  await page.getByRole("link", { name: "Leave demo" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#demoRow")).toBeHidden(); // never shown in the real app
});

test("Reset brings the banner back with the fresh start", async ({ page }) => {
  await noServer(page);
  await page.goto("/?demo");
  await page.getByRole("button", { name: "Close the demo banner" }).click();
  await page.locator("#settingsBtn").click();
  await page.locator("#resetBtn").click();
  await expect(page.getByRole("complementary", { name: "Demo" })).toBeVisible();
});
