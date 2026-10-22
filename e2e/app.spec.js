// End-to-end: the PWA on its own (offline mode, localStorage only), in a real browser.
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Keep tests hermetic: no web fonts from the network.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.goto("/");
});

test("first launch shows starter quests and a level-1 HUD", async ({ page }) => {
  await expect(page.locator("#lvl")).toHaveText("Level 1");
  await expect(page.locator("#xp")).toHaveText("0 XP · 0/50 to next");
  await expect(page.getByText("Check off this quest")).toBeVisible();
  await expect(page.getByText("Tiny step: Tap the box on the left")).toBeVisible();
});

test("completing a quest awards XP, shows a reward and moves it to Done", async ({ page }) => {
  await page.getByLabel("Complete Check off this quest").click();
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next");
  await expect(page.locator("#toast")).toHaveClass(/show/);
  await expect(page.locator("#streak")).toHaveText("🔥 1-day streak");
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByRole("heading", { name: "Done (1)" })).toBeVisible();
});

test("a mood check-in earns XP once per day and shows on the card", async ({ page }) => {
  page.on("dialog", (d) => d.accept("slept ok"));
  await page.getByRole("button", { name: "6 out of 10, Okay" }).click();
  await expect(page.locator(".mood-card .now-label")).toHaveText("6 · Okay");
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next");
  await page.getByRole("button", { name: "7 out of 10, Decent" }).click();
  await expect(page.locator(".mood-card .now-label")).toHaveText("7 · Decent");
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next");
});

test("a low mood shows the gentle note", async ({ page }) => {
  page.on("dialog", (d) => d.accept(""));
  await page.getByRole("button", { name: "3 out of 10, Rough" }).click();
  await expect(page.locator(".mood-care")).toBeVisible();
});

test("adding a quest in the editor persists across reloads", async ({ page }) => {
  await page.getByRole("button", { name: "Add quest" }).click();
  await page.getByLabel("Quest", { exact: true }).fill("Plaster the ceiling");
  await page.getByLabel(/Tiny first step/).fill("Mix one small batch");
  await page.getByLabel("Category").fill("House");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Plaster the ceiling")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Plaster the ceiling")).toBeVisible();
  await expect(page.getByText("Tiny step: Mix one small batch")).toBeVisible();
});

test("Journey shows stats, an earned badge and the activity log", async ({ page }) => {
  await page.getByLabel("Complete Check off this quest").click();
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect(page.locator(".tile").first()).toContainText("1");
  await expect(page.locator(".badge.got")).toContainText("First Step");
  await expect(page.locator(".log")).toContainText("✓ Check off this quest");
});

test("the Frozen? button gives XP and logs a thaw", async ({ page }) => {
  await page.locator("#freeze").click();
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next");
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect(page.locator(".log")).toContainText("Broke the freeze");
});
