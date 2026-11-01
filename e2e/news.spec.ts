// "What's new": shown once, after the opening screen, to people who already use the app.
import { expect, test, type Page } from "@playwright/test";
import { NEWS } from "../src/core/news";

const latest = NEWS[0];

/** Someone who has used the app before: a saved state, the welcome done, the opening screen on. */
async function returning(page: Page, prefix = "") {
  await page.addInitScript((p) => {
    if (localStorage.getItem(p + "quest-log-v2")) return;
    localStorage.setItem(p + "quest-log-welcome", "0");
    localStorage.setItem(p + "quest-log-v2", JSON.stringify({ v: 2, xp: 120, nextId: 1, quests: [] }));
  }, prefix);
}

test("a returning user sees it once, after Tap to begin, and Got it keeps it away", async ({ page }) => {
  await returning(page);
  await page.goto("/");
  const news = page.locator("#newsBanner");
  await expect(page.locator("#splash")).toBeVisible();
  await expect(news).toBeHidden(); // never under the opening screen
  await page.getByRole("button", { name: /Tap to begin/ }).click();
  await expect(news).toBeVisible();
  await expect(news).toContainText(latest.title);
  await expect(news).toContainText(latest.body);
  await news.getByRole("button", { name: "Got it" }).click();
  await expect(news).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: /Tap to begin/ }).click();
  await expect(page.locator("#lvl")).toBeVisible();
  await expect(news).toBeHidden();
});

test("someone opening the app for the first time never sees it", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("quest-log-splash", "0");
    localStorage.setItem("quest-log-welcome", "0");
  });
  await page.goto("/");
  await expect(page.locator("#lvl")).toHaveText("Level 1 · Wanderer");
  await expect(page.locator("#newsBanner")).toBeHidden();
  await page.reload();
  await expect(page.locator("#lvl")).toBeVisible();
  await expect(page.locator("#newsBanner")).toBeHidden();
});

test("the demo keeps its own 'seen', apart from the real app", async ({ page }) => {
  await returning(page, "quest-log-demo:");
  await page.addInitScript(() => {
    localStorage.setItem("news-seen", "the real app saw something else");
  });
  await page.goto("/?demo");
  await page.getByRole("button", { name: /Tap to begin/ }).click();
  await expect(page.locator("#newsBanner")).toContainText(latest.title);
});
