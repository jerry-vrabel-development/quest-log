// Memory drops: rewards made from your own record, and notes from past you.
import AxeBuilder from "@axe-core/playwright";
import { logMood } from "./helpers";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
  });
  page.on("dialog", (d) => d.accept(""));
  await page.goto("/");
});

/** Seeds a history: a big Career day 3 days ago and yesterday active, plus optional notes. */
async function seedHistory(page: Page, notes: string[] = []) {
  // Nothing is saved until the first change, so save the starter quests first (via a setting).
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#themeSel").selectOption("light");
  await page.keyboard.press("Escape");
  await page.evaluate((notes) => {
    const ymd = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const day = ymd(-3);
    const base = Date.now() - 3 * 86_400_000;
    const names = ["Applied: Focus Consulting", "Applied: Instrumentl", "Applied: PrairieLearn"];
    const S = JSON.parse(localStorage.getItem("quest-log-v2") ?? "{}") as Record<string, unknown>;
    S.days = [ymd(-3), ymd(-2), ymd(-1)];
    S.log = names
      .map((name, i) => ({ t: "quest", at: base + i, day, id: 900 + i, name, g: "Career", xp: 20 }))
      .reverse();
    S.notes = notes.map((text, i) => ({ at: base + 10 + i, day, text }));
    localStorage.setItem("quest-log-v2", JSON.stringify(S));
  }, notes);
  await page.reload();
}

async function noAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("on a hard day, a note from past you comes back", async ({ page }) => {
  await seedHistory(page, ["You've come back before. You will again."]);
  await logMood(page, "3 out of 10, Rough");
  // The first check-in earns a badge, which opens the chest; the memory rides along inside it.
  const chest = page.locator(".chest-overlay");
  await expect(chest.locator(".chest-memory")).toContainText("A note from you");
  await expect(chest.locator(".chest-memory")).toContainText("You've come back before. You will again.");
  await expect(chest.locator(".chest-memory-label")).toContainText("From your record");
});

test("a jackpot brings back one of your best days", async ({ page }) => {
  await seedHistory(page);
  await page.getByLabel("Complete Check off this quest").click(); // First Step badge: a jackpot
  const memory = page.locator(".chest-overlay .chest-memory");
  await expect(memory).toContainText("3 quests and 60 XP in one day");
  await expect(memory).toContainText("Applied: Focus Consulting");
  await expect(page.locator(".chest-overlay")).toHaveClass(/opened/);
  await page.locator(".chest-overlay").evaluate((d) =>
    Promise.all(
      d
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  );
  await noAxeViolations(page);
});

test("an ordinary quest can bring back earlier wins in the same area, as a toast", async ({ page }) => {
  await seedHistory(page);
  await page.getByLabel("Complete Check off this quest").click();
  await page.getByRole("button", { name: "Collect" }).click();
  // 0.3: a common drop (a "good" moment), and under its 50% chance of bringing back a memory.
  await page.evaluate(() => (Math.random = () => 0.3));
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByLabel("Complete Update one line of your resume").click(); // a Career quest
  const toast = page.locator("#toast");
  await expect(toast).toContainText("from your record", { timeout: 15_000 });
  await expect(toast).toContainText("Career: 3 quests done");
});

test("memories don't repeat right away", async ({ page }) => {
  await seedHistory(page, ["Only note"]);
  await logMood(page, "3 out of 10, Rough");
  await expect(page.locator(".chest-memory")).toContainText("Only note");
  await page.getByRole("button", { name: "Collect" }).click();
  const seen = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("quest-log-v2") ?? "{}") as { memSeen?: string[] }).memSeen,
  );
  expect(seen?.some((id) => id.startsWith("note:"))).toBe(true);
});

test("notes from past you can be written and deleted in Journey", async ({ page }) => {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByLabel(/Write one on a good day/).fill("Bash still needs his walk. Start there.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.locator(".notes")).toContainText("Bash still needs his walk. Start there.");
  await noAxeViolations(page);
  await page.reload();
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect(page.locator(".notes")).toContainText("Bash still needs his walk.");
  await page.getByRole("button", { name: /Delete note from/ }).click();
  await expect(page.locator(".notes")).toHaveCount(0);
});
