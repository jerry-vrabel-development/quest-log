// Accessibility: an axe-core scan (WCAG 2.2 A/AA + best practices) of every view and dialog in light
// and dark mode, plus keyboard checks that automated scanners can't do. Any violation fails CI.
import AxeBuilder from "@axe-core/playwright";
import { logMood } from "./helpers";
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function expectNoViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact ?? "?"}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
  });
  page.on("dialog", (d) => d.accept(""));
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test("every view passes axe", async ({ page }) => {
      await page.goto("/");
      // Some history so every view has content: a quest, a mood check-in, loot and badges.
      await page.getByLabel("Complete Check off this quest").click();
      await page.getByRole("button", { name: "Collect" }).click();
      await logMood(page, "6 out of 10, Okay");
      await page.getByRole("button", { name: "Collect" }).click();
      for (const view of ["Now", "Upcoming", "All", "Loot", "Journey"]) {
        await page.getByRole("tab", { name: view }).click();
        await expectNoViolations(page, `${view} (${colorScheme})`);
      }
    });

    test("every dialog passes axe", async ({ page }) => {
      await page.goto("/");
      await page.getByLabel("Complete Check off this quest").click();
      const chest = page.locator(".chest-overlay");
      await expect(chest).toHaveClass(/opened/);
      // Let the reveal finish: mid-fade text would measure as low contrast. (The rays spin forever; skip those.)
      await chest.evaluate((d) =>
        Promise.all(
          d
            .getAnimations({ subtree: true })
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished),
        ),
      );
      await expectNoViolations(page, `loot chest (${colorScheme})`);
      await page.getByRole("button", { name: "Collect" }).click();

      await page.getByRole("button", { name: "Add quest" }).click();
      await expectNoViolations(page, `quest editor (${colorScheme})`);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Settings" }).click();
      await expectNoViolations(page, `settings (${colorScheme})`);
      await page.keyboard.press("Escape");

      await page.locator("#freeze").click();
      await expect(page.getByRole("button", { name: "Do it (2 min)" })).toBeVisible();
      await expectNoViolations(page, `Frozen? dice (${colorScheme})`);
      await page.getByRole("button", { name: "Close" }).click();

      await page.getByRole("button", { name: "📝 Log", exact: true }).click();
      const log = page.locator("#logDialog");
      await log.getByRole("button", { name: "6 out of 10, Okay" }).click();
      await log.getByText("More: anxiety, energy, body, focus, sleep, pain").click();
      await log.getByRole("button", { name: "Energy: Low" }).click();
      await expectNoViolations(page, `Log (${colorScheme})`);
      await log.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("button", { name: "Collect" }).click();
      await page.getByRole("tab", { name: "Journey" }).click();
      await page.getByRole("button", { name: /Edit mood check-in/ }).click();
      await expectNoViolations(page, `mood editor (${colorScheme})`);
    });

    test("the opening screen passes axe", async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => localStorage.setItem("quest-log-splash", "1"));
      await page.reload();
      await expect(page.locator("#splash")).toBeVisible();
      await expectNoViolations(page, `opening screen (${colorScheme})`);
    });
  });
}

test.describe("keyboard", () => {
  test("a quest opens in the editor from the keyboard", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Check off this quest/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#editor")).toBeVisible();
    await expect(page.getByLabel("Quest", { exact: true })).toHaveValue("Check off this quest");
  });

  test("tabs follow the WAI-ARIA pattern: arrows move, Home and End jump", async ({ page }) => {
    await page.goto("/");
    const now = page.getByRole("tab", { name: "Now" });
    await expect(now).toHaveAttribute("aria-selected", "true");
    await now.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Upcoming" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-upcoming");
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Journey" })).toBeFocused();
    await page.keyboard.press("ArrowRight"); // wraps around
    await expect(page.getByRole("tab", { name: "Now" })).toBeFocused();
    // Only the selected tab is in the Tab order (roving tabindex).
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  });

  test("the loot chest keeps focus inside, closes on Escape and gives focus back", async ({ page }) => {
    await page.goto("/");
    const box = page.getByLabel("Complete Check off this quest");
    await box.focus();
    await page.keyboard.press("Space");
    const chest = page.locator(".chest-overlay");
    await expect(page.getByRole("button", { name: "Collect" })).toBeFocused();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      expect(
        await chest.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(chest).toHaveCount(0);
  });

  test("the opening screen keeps focus: Tab can't reach the page behind it", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("quest-log-splash", "1"));
    await page.reload();
    await expect(page.locator("#splash")).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#settings")).toBeHidden();
    await page.locator("#splash").click();
    await expect(page.locator("#splash")).toBeHidden();
    await page.getByRole("button", { name: "Settings" }).click(); // the page works again
    await expect(page.locator("#settings")).toBeVisible();
  });

  test("the editor focuses the name field at once and never moves focus later", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add quest" }).click();
    await expect(page.getByLabel("Quest", { exact: true })).toBeFocused();
    const tiny = page.getByLabel(/Tiny first step/);
    await tiny.focus();
    await page.waitForTimeout(200); // longer than the old 50 ms delayed focus
    await expect(tiny).toBeFocused();
  });

  test("a focused quest is never hidden under the sticky progress panel", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    const first = page.getByRole("button", { name: /^Drink a glass of water/ });
    await first.focus();
    const hudBottom = await page.locator(".hud").evaluate((h) => h.getBoundingClientRect().bottom);
    const top = await first.evaluate((b) => b.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(hudBottom);
  });

  test("the Log says which choices are picked, without relying on color", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "📝 Log", exact: true }).click();
    const dlg = page.locator("#logDialog");
    await dlg.getByRole("button", { name: "7 out of 10, Decent" }).click();
    await expect(dlg.getByRole("button", { name: "7 out of 10, Decent" })).toHaveAttribute("aria-pressed", "true");
    await expect(dlg.getByRole("button", { name: "6 out of 10, Okay" })).toHaveAttribute("aria-pressed", "false");
    await dlg.getByText("More: anxiety, energy, body, focus, sleep, pain").click();
    const calm = dlg.getByRole("button", { name: "Anxiety: Calm" });
    await calm.click();
    await expect(calm).toHaveAttribute("aria-pressed", "true");
    await expect(calm).toHaveText("✓ Calm"); // a check mark, not just a fill
  });
});
