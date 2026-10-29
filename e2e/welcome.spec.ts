// The welcome flow (#84): first launch asks three skippable questions and builds starter quests to fit.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** A brand-new visitor. The opening screen is off unless `splash` is set, and the welcome is left on. */
async function newcomer(page: Page, { splash = false } = {}) {
  await page.addInitScript((splashOn) => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null)
      localStorage.setItem("quest-log-splash", splashOn ? "1" : "0");
  }, splash);
}

test("a newcomer answers three questions and gets quests that fit, plus a greeting", async ({ page }) => {
  await newcomer(page);
  await page.goto("/");
  const welcome = page.getByRole("dialog", { name: "Welcome to Quest Log" });
  await expect(welcome).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .include("#welcome")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  await welcome.getByLabel(/What should we call you/).fill("Rhiannon");
  await welcome.getByLabel("🐾 Pet").check();
  await welcome.getByLabel("🎨 Art").check();
  await welcome.getByLabel(/Something else that matters/).fill("Garden");
  await welcome.getByLabel("Getting started when I'm frozen").check();
  await welcome.getByRole("button", { name: "Make it mine" }).click();
  await expect(welcome).toBeHidden();

  await expect(page.locator("#greeting")).toHaveText(/^(Good (morning|afternoon|evening)|Hey), Rhiannon\.$/);
  await page.getByRole("tab", { name: "All" }).click();
  for (const name of ["Walk or play with your pet", "Make something for 10 minutes", "One small step for Garden"])
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Check off this quest/ })).toBeVisible(); // the tour stays
  await expect(page.getByRole("button", { name: /^Apply to one job/ })).toHaveCount(0); // generic starter swapped
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Welcome to Quest Log" })).toBeHidden(); // once is enough
  await expect(page.locator("#greeting")).toContainText("Rhiannon");
});

test("Skip for now keeps the usual starters and never asks again on its own", async ({ page }) => {
  await newcomer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("button", { name: /^Apply to one job/ })).toHaveCount(0); // it's tomorrow's, not in Now
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByRole("button", { name: /^Apply to one job/ })).toBeVisible();
  await expect(page.locator("#greeting")).toHaveText("");
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Welcome to Quest Log" })).toBeHidden();
});

test("with the opening screen on, the welcome waits until you tap to begin", async ({ page }) => {
  await newcomer(page, { splash: true });
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Welcome to Quest Log" })).toBeHidden();
  await page.getByRole("button", { name: "Tap to begin" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Quest Log" })).toBeVisible();
});

test("Settings: change your name, or run the welcome again with your answers filled in", async ({ page }) => {
  await newcomer(page);
  await page.goto("/");
  const welcome = page.getByRole("dialog", { name: "Welcome to Quest Log" });
  await welcome.getByLabel(/What should we call you/).fill("Rhi");
  await welcome.getByLabel("🐾 Pet").check();
  await welcome.getByRole("button", { name: "Make it mine" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  const name = page.getByLabel("Your name");
  await expect(name).toHaveValue("Rhi");
  await name.fill("Rhiannon");
  await name.press("Tab");
  await expect(page.locator("#greeting")).toContainText("Rhiannon");
  await page.getByRole("button", { name: "Run the welcome again" }).click();
  await expect(welcome).toBeVisible();
  await expect(welcome.getByLabel(/What should we call you/)).toHaveValue("Rhiannon");
  await expect(welcome.getByLabel("🐾 Pet")).toBeChecked();
});

test("never shows in the demo", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("quest-log-demo:quest-log-splash", "0");
  });
  await page.goto("/?demo");
  await expect(page.getByRole("complementary", { name: "Demo" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Welcome to Quest Log" })).toBeHidden();
});
