// Smart quick-add (#79): plain words in the Quest field become a schedule, but only when you say so.
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add quest", exact: true }).click();
});

test("shows what it understood, and fills the schedule only after Use this", async ({ page }) => {
  const editor = page.locator("#editor");
  const quest = editor.getByLabel("Quest", { exact: true });
  await quest.fill("Call dentist tomorrow 10am");
  await expect(editor.getByRole("status")).toHaveText("Understood: Call dentist · Tomorrow · 10:00 AM");
  await expect(editor.getByLabel("Date", { exact: true })).toHaveValue(""); // nothing changes on its own
  await editor.getByRole("button", { name: "Use this" }).click();
  await expect(quest).toHaveValue("Call dentist");
  await expect(editor.getByLabel("Time", { exact: true })).toHaveValue("10:00");
  await expect(editor.getByLabel("Date", { exact: true })).not.toHaveValue("");
  await expect(editor.locator("#quickBox")).toBeHidden();
  await editor.getByRole("button", { name: "Save" }).click();
  await page.getByRole("tab", { name: "Upcoming" }).click(); // tomorrow's quests live there
  await expect(page.getByRole("button", { name: /^Call dentist/ })).toContainText("Tomorrow 10:00 AM");
});

test("repeats too: every weekday at 9", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.getByLabel("Quest", { exact: true }).fill("Apply to one job every weekday at 9");
  await expect(editor.getByRole("status")).toHaveText("Understood: Apply to one job · Weekdays · 9:00 AM");
  await editor.getByRole("button", { name: "Use this" }).click();
  await expect(editor.locator('select[name="repeat"]')).toHaveValue("weekdays");
  await expect(editor.getByLabel("Time", { exact: true })).toHaveValue("09:00");
});

test("stays out of the way when there's nothing to understand", async ({ page }) => {
  const editor = page.locator("#editor");
  await editor.getByLabel("Quest", { exact: true }).fill("Read chapter 10");
  await expect(editor.locator("#quickBox")).toBeHidden();
});

test("only offers itself for new quests, not when editing", async ({ page }) => {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Check off this quest Tiny step/ }).click();
  const editor = page.locator("#editor");
  await editor.getByLabel("Quest", { exact: true }).fill("Check off this quest tomorrow");
  await expect(editor.locator("#quickBox")).toBeHidden();
  await expect(editor.locator("#quickHint")).toBeHidden();
});
