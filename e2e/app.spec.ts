// End-to-end: the PWA on its own (offline mode, localStorage only), in a real browser.
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    /** Sounds started, in order, recorded by the AudioContext stub below. */
    __sounds: ("marker" | "tone")[];
  }
}

test.beforeEach(async ({ page }) => {
  // Keep tests hermetic: no web fonts from the network.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // Record sounds instead of playing them: the marker is a noise buffer, rewards are oscillators.
  await page.addInitScript(() => {
    // Deterministic loot: 0.5 always rolls a common drop, so jackpots come only from the rules under test.
    Math.random = () => 0.5;
    // Most tests skip the opening screen; the splash tests turn it back on.
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
    window.__sounds = [];
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      override createBufferSource() {
        window.__sounds.push("marker");
        return super.createBufferSource();
      }
      override createOscillator() {
        window.__sounds.push("tone");
        return super.createOscillator();
      }
    };
  });
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.goto("/");
});

/** Closes the jackpot chest if one is showing. */
async function collect(page: Page) {
  const chest = page.getByRole("dialog");
  await chest.getByRole("button", { name: "Collect" }).click();
  await expect(chest).toBeHidden();
}

test("first launch shows starter quests and a level-1 HUD", async ({ page }) => {
  await expect(page.locator("#lvl")).toHaveText("Level 1");
  await expect(page.locator("#xp")).toHaveText("0 XP · 0/50 to next");
  await expect(page.getByText("Check off this quest")).toBeVisible();
  await expect(page.getByText("Tiny step: Tap the box on the left")).toBeVisible();
});

test("the first quest ever is a jackpot: the chest opens for the First Step badge", async ({ page }) => {
  await page.getByLabel("Complete Check off this quest").click();
  const chest = page.getByRole("dialog");
  await expect(chest).toBeVisible();
  await expect(chest.locator(".chest-title")).toHaveText("Badge: 🥾 First Step");
  await expect(chest).toHaveClass(/opened/);
  await collect(page);
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next");
  await expect(page.locator("#streak")).toHaveText("🔥 1-day streak");
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByRole("heading", { name: "Done (1)" })).toBeVisible();
});

test("the marker click plays first, then the reward", async ({ page }) => {
  await page.locator("#lvl").click(); // the first tap of a session plays the welcome chime
  await page.evaluate(() => (window.__sounds = []));
  await page.getByLabel("Complete Check off this quest").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const sounds = await page.evaluate(() => window.__sounds);
  expect(sounds[0]).toBe("marker");
  expect(sounds.filter((s) => s === "tone").length).toBeGreaterThan(5); // the fanfare
});

test("an ordinary quest gets a toast, not the chest", async ({ page }) => {
  await page.getByLabel("Complete Check off this quest").click();
  await collect(page);
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByLabel("Complete Update one line of your resume").click(); // 15 XP, no new badge
  await expect(page.locator("#toast")).toHaveClass(/show/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("sound can be turned off, and stays off", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#soundSel").selectOption("0");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByLabel("Complete Check off this quest").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => window.__sounds)).toEqual([]);
  await collect(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#soundSel")).toHaveValue("0");
});

test("the chest can be dismissed with Escape", async ({ page }) => {
  await page.getByLabel("Complete Check off this quest").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("with reduced motion, the chest opens without animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByLabel("Complete Check off this quest").click();
  await expect(page.getByRole("dialog")).toHaveClass(/opened/);
  await expect(page.locator("canvas.confetti")).toHaveCount(0);
});

test("a mood check-in earns XP once per day and shows on the card", async ({ page }) => {
  page.on("dialog", (d) => d.accept("slept ok"));
  await page.getByRole("button", { name: "6 out of 10, Okay" }).click();
  await collect(page); // Honest Check-in badge
  await expect(page.locator(".mood-card .now-label")).toHaveText("6 · Okay");
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next");
  await page.getByRole("button", { name: "7 out of 10, Decent" }).click();
  await expect(page.locator(".mood-card .now-label")).toHaveText("7 · Decent");
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next");
});

test("a low mood shows the gentle note, and the first quest after it is a hard-day jackpot", async ({ page }) => {
  page.on("dialog", (d) => d.accept(""));
  await page.getByRole("button", { name: "3 out of 10, Rough" }).click();
  await expect(page.locator(".mood-care")).toBeVisible();
  await collect(page);
  await page.getByLabel("Complete Check off this quest").click();
  const chest = page.getByRole("dialog");
  await expect(chest).toContainText("You moved on a hard day.");
  await expect(chest.locator(".chest-loot")).toBeVisible(); // low days always drop loot
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
  await collect(page);
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect(page.locator(".tile").first()).toContainText("1");
  await expect(page.locator(".badge.got")).toContainText("First Step");
  await expect(page.locator(".log")).toContainText("✓ Check off this quest");
});

test("Frozen? rolls one tiny step; doing it gives XP and logs what broke the freeze", async ({ page }) => {
  await page.locator("#freeze").click();
  const dice = page.locator("#dice");
  await expect(dice).toBeVisible();
  await expect(dice.getByRole("button", { name: "Do it (2 min)" })).toBeVisible();
  const step = (await dice.locator("#diceStep").textContent()) ?? "";
  expect(step.length).toBeGreaterThan(0);
  await expect(dice.locator("#diceFrom")).toContainText("From: ");

  await dice.getByRole("button", { name: "Do it (2 min)" }).click();
  await expect(dice.locator("#diceTimer")).toHaveText("2:00");
  await dice.getByRole("button", { name: "Done ✓" }).click();
  await expect(dice).toBeHidden();
  await collect(page); // Thaw badge
  await expect(page.locator("#xp")).toHaveText("5 XP · 5/50 to next");
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect(page.locator(".log")).toContainText(`Broke the freeze: ${step}`);
});

test("rolling clacks on each bounce, then lands", async ({ page }) => {
  await page.locator("#lvl").click(); // the welcome chime
  await page.evaluate(() => (window.__sounds = []));
  await page.locator("#freeze").click();
  await expect(page.getByRole("button", { name: "Do it (2 min)" })).toBeVisible();
  const sounds = await page.evaluate(() => window.__sounds);
  expect(sounds.filter((s) => s === "marker").length).toBe(4); // four bounces
});

test("Roll again lands on a different tiny step", async ({ page }) => {
  await page.locator("#freeze").click();
  const dice = page.locator("#dice");
  await expect(dice.getByRole("button", { name: "Do it (2 min)" })).toBeVisible();
  const first = await dice.locator("#diceStep").textContent();
  await dice.getByRole("button", { name: "Roll again" }).click();
  await expect(dice.getByRole("button", { name: "Do it (2 min)" })).toBeVisible();
  await expect(dice.locator("#diceStep")).not.toHaveText(first ?? "");
});

test("closing the dice gives nothing and logs nothing", async ({ page }) => {
  await page.locator("#freeze").click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("#dice")).toBeHidden();
  await expect(page.locator("#xp")).toHaveText("0 XP · 0/50 to next");
});

test.describe("opening screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("quest-log-splash", "1"));
    await page.reload();
  });

  test("shows level and streak, then 'Tap to begin' plays the welcome chime and clears it", async ({ page }) => {
    const splash = page.locator("#splash");
    await expect(splash).toBeVisible();
    await expect(splash).toContainText("Level 1");
    await page.evaluate(() => (window.__sounds = []));
    await splash.click();
    await expect(splash).toBeHidden();
    expect((await page.evaluate(() => window.__sounds)).length).toBeGreaterThan(0);
  });

  test("can be turned off in Settings", async ({ page }) => {
    await page.locator("#splash").click();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("#splashSel").selectOption("0");
    await page.reload();
    await expect(page.locator("#splash")).toBeHidden();
  });
});
