// Moments: capture a photo, video, song, recording or movie when it's good; it comes back as a memory drop when it's not.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

/** Tiny test videos: a 2-second clip, and a 70-second one (over the one-minute limit). */
const CLIP = fileURLToPath(new URL("fixtures/clip-2s.webm", import.meta.url));
const LONG_CLIP = fileURLToPath(new URL("fixtures/clip-70s.webm", import.meta.url));

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

/** Simulates a slow disk: every file write reports success a second late. Reloads to apply. */
async function slowDisk(page: Page) {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the store as `this`
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      const req = put.apply(this, args);
      let handler: ((e: Event) => void) | null = null;
      Object.defineProperty(req, "onsuccess", {
        set: (f: (e: Event) => void) => {
          handler = f;
        },
        get: () => handler,
      });
      req.addEventListener("success", (e) => setTimeout(() => handler?.(e), 1000));
      return req;
    };
  });
  await page.reload();
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
  // Saved files are listed in the background after a load; until then a reward can't pick them.
  await expect(page.locator("html")).toHaveAttribute("data-media", "ready");
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
  await expect(dlg.getByRole("alert")).toHaveText("Add the song's name, a link, or a music file.");
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

/** One second of a 440 Hz tone as a WAV file, standing in for a local music file. */
function toneWav(): Buffer {
  const rate = 8000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const playable = (player: ReturnType<Page["locator"]>) =>
  expect
    .poll(() => player.evaluate((a: HTMLMediaElement) => (Number.isFinite(a.duration) ? a.duration : 0)), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

test("a song can carry its local music file, which plays back from Journey", async ({ page }) => {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "Add a moment" }).click();
  const dlg = page.locator("#momentDialog");
  await dlg.getByLabel("🎵 Song").check();
  await dlg
    .getByLabel(/^Music file/)
    .setInputFiles({ name: "01 - Harvest_Moon.wav", mimeType: "audio/wav", buffer: toneWav() });
  await expect(dlg.getByLabel("Song name")).toHaveValue("Harvest Moon"); // guessed from the file name
  await playable(dlg.locator("#momentAudioPreview"));
  await dlg.getByRole("button", { name: "Save moment" }).click();
  const audio = page.locator(".moments audio");
  await expect(audio).toHaveAttribute("aria-label", "Play Harvest Moon");
  await playable(audio);
  expect(await audio.evaluate((a: HTMLAudioElement) => a.autoplay)).toBe(false);
  await noAxeViolations(page);
});

test("a recording made in the app is saved and plays back", async ({ page }) => {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "Add a moment" }).click();
  const dlg = page.locator("#momentDialog");
  await dlg.getByLabel("🎙️ Recording").check();
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg.getByRole("alert")).toHaveText("Record something first.");
  const rec = dlg.locator("#recordBtn");
  await rec.click();
  await expect(rec).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1200);
  await rec.click();
  await expect(dlg.locator("#recordStatus")).toHaveText("Recorded. Play it back, or record again.");
  await expect(dlg.locator("#recordPreview")).toBeVisible();
  await dlg.getByLabel(/^What is it/).fill("the new riff");
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator(".moments")).toContainText("🎙️ the new riff");
  await expect(page.locator(".moments audio")).toHaveAttribute("aria-label", "Play your recording: the new riff");
  await expect.poll(() => page.locator(".moments audio").evaluate((a: HTMLAudioElement) => a.src)).toMatch(/^blob:/);
});

test("on a hard day, a song you saved comes back ready to play, and the chest stays open while you listen", async ({
  page,
}) => {
  // This test is about audio, so skip the chest's animation and confetti (they compete for CPU in parallel runs).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await slowDisk(page); // the CI container's disk is slow; make every run that slow
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "Add a moment" }).click();
  const dlg = page.locator("#momentDialog");
  await dlg.getByLabel("🎵 Song").check();
  await dlg
    .getByLabel(/^Music file/)
    .setInputFiles({ name: "harvest-moon.wav", mimeType: "audio/wav", buffer: toneWav() });
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg).toBeHidden(); // saved (file and moment) before we touch storage and reload
  await ageMoments(page);
  await page.getByRole("button", { name: "3 out of 10, Rough" }).click(); // badge chest, with the song inside
  const chest = page.locator(".chest-overlay");
  await expect(chest).toHaveClass(/opened/);
  const audio = chest.locator(".chest-memory audio");
  await playable(audio);
  await audio.click(); // interacting inside the card doesn't close the chest
  await expect(chest).toBeVisible();
  await chest.getByRole("button", { name: "Collect" }).click();
  await expect(chest).toHaveCount(0);
});

/* ---------- video ---------- */

async function addVideoMoment(page: Page, file: string, caption: string) {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "Add a moment" }).click();
  const dlg = page.locator("#momentDialog");
  await dlg.getByLabel("🎬 Video").check();
  await dlg.getByLabel(/^Video/).setInputFiles(file);
  await dlg.getByLabel("Caption").fill(caption);
  return dlg;
}

test("a short video is saved on the device and plays back from Journey, never by itself", async ({ page }) => {
  const dlg = await addVideoMoment(page, CLIP, "Bash in the waves");
  await playable(dlg.locator("#momentVideoPreview"));
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg).toBeHidden();
  const video = page.locator(".moments video");
  await expect(video).toHaveAttribute("aria-label", /^Play the video from .+: Bash in the waves$/);
  await playable(video);
  expect(await video.evaluate((v: HTMLVideoElement) => [v.autoplay, v.paused, v.playsInline])).toEqual([
    false,
    true,
    true,
  ]);
  await noAxeViolations(page);
});

test("a video over a minute is turned away with a clear reason", async ({ page }) => {
  const dlg = await addVideoMoment(page, LONG_CLIP, "too long");
  await expect(dlg.getByRole("alert")).toHaveText(
    "That video is 70 seconds. Moments hold up to a minute: trim it first, or pick a shorter one.",
  );
  await expect(dlg.locator("#momentVideoPreview")).toBeHidden();
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg.getByRole("alert")).toHaveText("Choose a video first.");
});

test("on a hard day, a video you saved comes back in the chest, ready to play", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dlg = await addVideoMoment(page, CLIP, "Bash in the waves");
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg).toBeHidden();
  await ageMoments(page);
  await page.getByRole("button", { name: "3 out of 10, Rough" }).click(); // badge chest, with the video inside
  const chest = page.locator(".chest-overlay");
  await expect(chest.locator(".chest-memory")).toContainText("A video from your day");
  const video = chest.locator(".chest-memory video");
  await playable(video);
  await video.click(); // interacting inside the card doesn't close the chest
  await expect(chest).toBeVisible();
  await chest.getByRole("button", { name: "Collect" }).click();
  await expect(chest).toHaveCount(0);
});
