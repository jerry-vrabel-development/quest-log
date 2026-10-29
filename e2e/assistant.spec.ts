// Settings → Connect an AI assistant (#80): the connector steps live in the app, not just the README.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const CODE = "a".repeat(43);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    for (const k of ["quest-log-splash", "quest-log-demo:quest-log-splash"])
      if (localStorage.getItem(k) === null) localStorage.setItem(k, "0");
  });
  // A quiet stand-in for the Worker: nothing synced yet.
  await page.route("**/api/**", (r) =>
    new URL(r.request().url()).pathname === "/api/config" ?
      r.fulfill({ json: { vapidPublicKey: "x" } })
    : r.fulfill({ status: 404, json: { error: "not_found" } }),
  );
});

/** Starts the app with sync already on (as if linked earlier). */
async function withSync(page: Page) {
  await page.addInitScript((code) => {
    localStorage.setItem("quest-log-sync", JSON.stringify({ code }));
  }, CODE);
}

const openSettings = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  return page.locator("#assistBox");
};

test("with sync off, it says to turn sync on first", async ({ page }) => {
  const box = await openSettings(page);
  await expect(box).toContainText("Connect an AI assistant");
  await expect(box).toContainText("First, turn on sync above.");
  await expect(page.locator("#assistSteps")).toBeHidden();
});

test("with sync on, it shows the steps and this app's connector address, and passes axe", async ({ page }) => {
  await withSync(page);
  const box = await openSettings(page);
  const steps = page.getByRole("list", { name: "Connect an AI assistant" });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await expect(page.locator("#assistUrl")).toHaveText(`${new URL(page.url()).origin}/mcp`);
  await expect(box).toContainText("Settings → Connectors → Add custom connector");
  await expect(box).toContainText("only paste it into Quest Log's own page");
  await expect(page.locator("#assistOff")).toBeHidden();
  const { violations } = await new AxeBuilder({ page })
    .include("#settings")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("the copy buttons put the address and the code on the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only here");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await withSync(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Copy address" }).click();
  await expect(page.locator("#assistStatus")).toHaveText("Address copied. Paste it as the connector URL.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/mcp`);
  await page.getByRole("button", { name: "Copy sync code" }).click();
  await expect(page.locator("#assistStatus")).toContainText("Sync code copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
});

test("the demo hides it, and its banner says the real app can connect an assistant", async ({ page }) => {
  await page.goto("/?demo");
  await expect(page.getByRole("complementary", { name: "Demo" })).toContainText(
    "The real app can also connect to an AI assistant like Claude.",
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#assistBox")).toBeHidden();
});
