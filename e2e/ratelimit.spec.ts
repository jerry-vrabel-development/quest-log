// When the server says "too many requests" (429), the app waits instead of hammering it (#64).
import { expect, test } from "@playwright/test";

test("on a 429 the app shows it's waiting and sends nothing until Retry-After passes", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    localStorage.setItem("quest-log-splash", "0");
    localStorage.setItem("quest-log-welcome", "0");
    localStorage.setItem("quest-log-sync", JSON.stringify({ code: "a".repeat(43) }));
  });
  const calls: string[] = [];
  await page.route("**/api/**", (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (path === "/api/config") return r.fulfill({ json: { vapidPublicKey: "x" } });
    calls.push(`${req.method()} ${path}`);
    return r.fulfill({ status: 429, headers: { "retry-after": "60" }, json: { error: "rate_limited" } });
  });
  await page.goto("/");
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#syncStatus")).toContainText("waiting a minute");
  const sent = calls.length;
  await page.keyboard.press("Escape");
  await page.getByLabel("Complete Check off this quest").click(); // a change that would normally sync
  await page.waitForTimeout(2500); // longer than the 1.2 s sync debounce
  expect(calls.length).toBe(sent); // nothing went out while paused
});
