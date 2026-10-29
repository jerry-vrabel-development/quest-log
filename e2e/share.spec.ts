// "Share how I'm doing": a short update for friends and family, edited by you, sent by your phone.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { logMood } from "./helpers";

const PHOTO = fileURLToPath(new URL("fixtures/lake.png", import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
    if (localStorage.getItem("quest-log-welcome") === null) localStorage.setItem("quest-log-welcome", "0");
    // Stand-in for the phone's share sheet: remember what would have been shared.
    const w = window as unknown as { shared: ShareData[] };
    w.shared = [];
    Object.assign(navigator, {
      share: (d: ShareData) => {
        w.shared.push({ text: d.text, files: d.files });
        return Promise.resolve();
      },
      canShare: () => true,
    });
  });
  await page.goto("/");
});

async function someHistory(page: Page) {
  await logMood(page, "4 out of 10, Low", {
    steps: ["Anxiety: Very high", "Energy: Low"],
    sleep: "about 6 hours",
    note: "private thought",
  });
  await page.getByRole("button", { name: "Collect" }).click();
  await page.getByLabel("Complete Check off this quest").click();
  await page.getByRole("button", { name: "Collect" }).click();
}

const shared = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { shared: ShareData[] }).shared.map((d) => ({ text: d.text, files: d.files?.length ?? 0 })),
  );

async function openShare(page: Page) {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "📤 Share how I'm doing" }).click();
  const dlg = page.locator("#shareDialog");
  await expect(dlg).toBeVisible();
  return dlg;
}

test("writes an update in words, keeps private things out, and shares exactly what you edited", async ({ page }) => {
  await someHistory(page);
  const dlg = await openShare(page);
  const text = dlg.getByLabel(/^The message/);
  await expect(text).toHaveValue(
    /^This week it's been a hard stretch\. Got 1 thing done, including Check off this quest\./,
  );
  await expect(text).toHaveValue(/Energy's been low, sleep: about 6 hours\./);
  const value = (await text.inputValue()).toLowerCase();
  for (const secret of ["anxiety", "private thought", "4/10", "low ("]) expect(value).not.toContain(secret);
  for (const off of ["Anxiety", "Pain", "My latest note"])
    await expect(dlg.getByLabel(off, { exact: true })).not.toBeChecked();

  await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze()
    .then((r) => {
      expect(r.violations.map((v) => v.id)).toEqual([]);
    });

  await text.fill("Hanging in there. Bash and I are okay.");
  await dlg.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dlg.locator("#shareStatus")).toHaveText("Shared.");
  expect(await shared(page)).toEqual([{ text: "Hanging in there. Bash and I are okay.", files: 0 }]);
});

test("private things go in only when you turn them on; the headline is one line", async ({ page }) => {
  await someHistory(page);
  const dlg = await openShare(page);
  const text = dlg.getByLabel(/^The message/);
  await dlg.getByLabel("Anxiety", { exact: true }).check();
  await dlg.getByLabel("My latest note", { exact: true }).check();
  await expect(text).toHaveValue(/anxiety's been very high/);
  await expect(text).toHaveValue(/"private thought"/);
  await dlg.getByLabel("Just the headline").check();
  await expect(text).toHaveValue("This week: It's been a hard stretch. 1 thing done.");
});

test("Copy puts the message on the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only here");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await someHistory(page);
  const dlg = await openShare(page);
  await dlg.getByRole("button", { name: "Copy" }).click();
  await expect(dlg.locator("#shareStatus")).toHaveText("Copied. Paste it into your message.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^This week it's been a hard stretch\./);
});

test("a highlight photo can go along with the message", async ({ page }) => {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "Add a moment" }).click();
  const m = page.locator("#momentDialog");
  await m.getByLabel("Photo", { exact: true }).setInputFiles(PHOTO);
  await expect(m.locator("#momentPreview")).toBeVisible();
  await m.getByLabel("Caption").fill("Bash at the lake");
  await m.getByRole("button", { name: "Save moment" }).click();
  await expect(m).toBeHidden();
  const dlg = await openShare(page);
  await expect(dlg.getByLabel(/^The message/)).toHaveValue(/Highlight: Bash at the lake\./);
  await dlg.getByLabel("Attach the highlight photo").check();
  await dlg.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dlg.locator("#shareStatus")).toHaveText("Shared.");
  expect((await shared(page))[0]?.files).toBe(1);
});

test("with nothing logged yet, it says so instead of inventing anything", async ({ page }) => {
  const dlg = await openShare(page);
  await expect(dlg.getByLabel(/^The message/)).toHaveValue("");
  await expect(dlg.locator("#shareStatus")).toHaveText(
    "Nothing in this period yet. Try a longer one, or write your own.",
  );
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(dlg).toBeHidden();
});
