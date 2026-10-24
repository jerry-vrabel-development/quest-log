// Moments: capture a photo, song or movie when it's good; it comes back as a memory drop when it's not.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** A tiny 80×60 test photo. */
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAFAAAAA8CAIAAAB+RarbAAAA/0lEQVR4nO2Zyw3CMBBEAVEH5aQEyqAIyqEEyqESDpFySYQCO2+RxvOO+TjztHZsy8fpfjuMxOnfAbqJsDsRdifC7kTYnQi7E2F3hhM+N3/vMb3WF6/PS1uAJuFNz/XdBnNc+LPq5sOoNjuGv7ItvrUTULiSm3OmhOuJIWdEWJWVcNYLa1PKnYdbeIiFiU6obTMVdkcpzE2ewpZTYXci7E6E3VEKcxt3YcupsDtiYaJXa9tMhctoCyLvMkiFVSmJAUJ16XpWaJIDx3AlMTelsz+t33KjJw/4UcucfucO3uFsaWYxGeX0cKHTbZMsPNyJsDsRdifC7kTYnQi7M5zwG1aSQehJWDBiAAAAAElFTkSuQmCC",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
  });
  page.on("dialog", (d) => d.accept(""));
  await page.goto("/");
});

async function noAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function addPhotoMoment(page: Page, caption: string) {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "Add a moment" }).click();
  const dlg = page.locator("#momentDialog");
  await dlg
    .getByLabel("Photo", { exact: true })
    .setInputFiles({ name: "lake.png", mimeType: "image/png", buffer: PHOTO });
  await expect(dlg.locator("#momentPreview")).toBeVisible();
  await dlg.getByLabel("Caption").fill(caption);
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg).toBeHidden();
}

/** Moves every saved moment to yesterday, so memory drops can bring it back. */
async function ageMoments(page: Page) {
  await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const S = JSON.parse(localStorage.getItem("quest-log-v2") ?? "{}") as { moments?: { day: string }[] };
    for (const m of S.moments ?? []) m.day = y;
    localStorage.setItem("quest-log-v2", JSON.stringify(S));
  });
  await page.reload();
}

test("a photo moment is saved on the device and shows in Journey", async ({ page }) => {
  await addPhotoMoment(page, "Bash chasing the gulls");
  const moment = page.locator(".moment").first();
  await expect(moment).toContainText("Bash chasing the gulls");
  const img = moment.locator("img.moment-img");
  await expect(img).toHaveAttribute("alt", "Bash chasing the gulls");
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  await page.getByRole("tab", { name: "Journey" }).click();
  await expect
    .poll(() =>
      page
        .locator(".moment img")
        .first()
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBeGreaterThan(0);
  await noAxeViolations(page);
});

test("a song moment needs a name or link, and links show where they're from", async ({ page }) => {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "Add a moment" }).click();
  const dlg = page.locator("#momentDialog");
  await dlg.getByLabel("🎵 Song").check();
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg.getByRole("alert")).toHaveText("Add the song's name or a link.");
  await dlg.getByLabel("Song name").fill("Harvest Moon");
  await dlg.getByLabel(/^Link/).fill("https://open.spotify.com/track/abc");
  await noAxeViolations(page);
  await dlg.getByRole("button", { name: "Save moment" }).click();
  const link = page.locator(".moment a.moment-link-card");
  await expect(link).toHaveText("🎵 Harvest Moon · Spotify");
  await expect(link).toHaveAttribute("href", "https://open.spotify.com/track/abc");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("after a good check-in, the app invites saving the moment (once a day)", async ({ page }) => {
  await page.getByRole("button", { name: "8 out of 10, Good" }).click();
  await page.getByRole("button", { name: "Collect" }).click();
  const invite = page.getByRole("region", { name: "Save this moment" });
  await expect(invite).toBeVisible();
  await invite.getByRole("button", { name: "Add a moment" }).click();
  await expect(page.locator("#momentTitle")).toHaveText("Save this moment?");
  await page.keyboard.press("Escape");
  await invite.getByRole("button", { name: "Not now" }).click();
  await expect(invite).toBeHidden();
  await page.getByRole("button", { name: "9 out of 10, Great" }).click(); // still dismissed for today
  await expect(page.getByRole("region", { name: "Save this moment" })).toBeHidden();
});

test("on a hard day, a photo you saved comes back front and center", async ({ page }) => {
  await addPhotoMoment(page, "Bash at the lake");
  await ageMoments(page);
  await page.getByRole("tab", { name: "Now" }).click();
  await page.getByRole("button", { name: "3 out of 10, Rough" }).click(); // first check-in: badge chest
  const memory = page.locator(".chest-overlay .chest-memory");
  await expect(memory).toContainText("A photo from your day");
  await expect(memory).toContainText("Bash at the lake");
  await expect.poll(() => memory.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

test("outside a jackpot, a moment memory opens full screen", async ({ page }) => {
  const addTitled = async (kind: string, field: string, title: string) => {
    await page.getByRole("button", { name: "Add a moment" }).click();
    const dlg = page.locator("#momentDialog");
    await dlg.getByLabel(kind).check();
    await dlg.getByLabel(field).fill(title);
    await dlg.getByRole("button", { name: "Save moment" }).click();
    await expect(dlg).toBeHidden();
  };
  await page.getByRole("tab", { name: "Journey" }).click();
  await addTitled("🎞️ Movie or show", "Title", "Heat");
  await addTitled("🎵 Song", "Song name", "Harvest Moon");
  await ageMoments(page);

  // First low check-in: the badge chest carries one moment...
  await page.getByRole("button", { name: "3 out of 10, Rough" }).click();
  const inChest = (await page.locator(".chest-memory b").textContent()) ?? "";
  await page.getByRole("button", { name: "Collect" }).click();
  // ...a second one (no XP, not a jackpot) still brings back the other, full screen.
  await page.getByRole("button", { name: "3 out of 10, Rough" }).click();
  const pop = page.locator("#memoryPop");
  await expect(pop).toBeVisible();
  await expect(pop.locator("#memoryPopLabel")).toContainText("From your record");
  const inPop = (await pop.getByRole("heading").textContent()) ?? "";
  expect([inChest, inPop].sort()).toEqual(["You watched Heat", "You were listening to Harvest Moon"]);
  await noAxeViolations(page);
  await pop.getByRole("button", { name: "Close" }).click();
  await expect(pop).toBeHidden();
});
