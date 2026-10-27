// Cloud backup of moment files: encrypted on the device, restored on another device, removed on delete.
// The e2e server is static, so a small in-test fake stands in for the Worker's /api routes.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { logMood } from "./helpers";

/** A tiny 80×60 test photo. */
const PHOTO = fileURLToPath(new URL("fixtures/lake.png", import.meta.url));
const GIF = fileURLToPath(new URL("fixtures/mood.gif", import.meta.url));
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** What the fake server holds: the synced state and the uploaded files, as the Worker would. */
interface Cloud {
  state: { state: unknown; updatedAt: number } | null;
  files: Map<string, { bytes: Buffer; at: number }>;
  auth: Set<string>;
}
const newCloud = (): Cloud => ({ state: null, files: new Map(), auth: new Set() });

async function serve(page: Page, cloud: Cloud) {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const auth = await req.headerValue("authorization");
    if (auth) cloud.auth.add(auth);
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const media = /^\/api\/media\/(.+)$/.exec(path)?.[1];
    if (path === "/api/config") return json({ vapidPublicKey: "x" });
    if (path === "/api/state" && method === "GET")
      return cloud.state ? json({ ...cloud.state, tz: "America/Chicago" }) : json({ error: "not_found" }, 404);
    if (path === "/api/state" && method === "PUT") {
      const body = req.postDataJSON() as { state: unknown; updatedAt: number };
      cloud.state = { state: body.state, updatedAt: body.updatedAt };
      return json({ ok: true, updatedAt: body.updatedAt });
    }
    if (path === "/api/media" && method === "GET") {
      const items = [...cloud.files].map(([id, f]) => ({ id, size: f.bytes.length, at: f.at }));
      return json({ items, used: items.reduce((n, i) => n + i.size, 0), quota: 2 * 1024 ** 3 });
    }
    if (media && method === "PUT") {
      const bytes = req.postDataBuffer() ?? Buffer.alloc(0);
      cloud.files.set(media, { bytes, at: Date.now() });
      return json({ ok: true, size: bytes.length });
    }
    if (media && method === "GET") {
      const f = cloud.files.get(media);
      return f ?
          route.fulfill({ status: 200, body: f.bytes, contentType: "application/octet-stream" })
        : json({ error: "not_found" }, 404);
    }
    if (path === "/api/account" && method === "DELETE") {
      const files = cloud.files.size;
      cloud.state = null;
      cloud.files.clear();
      return json({ ok: true, files });
    }
    if (media && method === "DELETE") {
      cloud.files.delete(media);
      return json({ ok: true });
    }
    return json({ error: "not_found" }, 404);
  });
}

const opened: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.close()));
});

/** A fresh device (its own storage), talking to `cloud`. `prompt` answers the "paste your code" box. */
async function device(browser: Browser, cloud: Cloud, prompt = "") {
  const context = await browser.newContext({ serviceWorkers: "block" });
  opened.push(context);
  const page = await context.newPage();
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    if (localStorage.getItem("quest-log-splash") === null) localStorage.setItem("quest-log-splash", "0");
  });
  page.on("dialog", (d) => d.accept(prompt));
  await serve(page, cloud);
  await page.goto("/");
  return page;
}

async function turnOnSync(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Turn on sync" }).click();
  await expect(page.locator("#syncStatus")).toContainText("synced");
  await page.keyboard.press("Escape");
}

async function addPhoto(page: Page, caption: string) {
  await page.getByRole("tab", { name: "Journey" }).click();
  await page.getByRole("button", { name: "Add a moment" }).click();
  const dlg = page.locator("#momentDialog");
  await dlg.getByLabel("Photo", { exact: true }).setInputFiles(PHOTO);
  await expect(dlg.locator("#momentPreview")).toBeVisible();
  await dlg.getByLabel("Caption").fill(caption);
  await dlg.getByRole("button", { name: "Save moment" }).click();
  await expect(dlg).toBeHidden();
}

/** The sealed private part of the state on the server, or "" if none yet. */
const sealedPart = (cloud: Cloud) => (cloud.state?.state as { vault?: string } | undefined)?.vault ?? "";

const syncCode = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem("quest-log-sync") ?? "{}") as { code?: string }).code ?? "");

test("with sync on, a moment's file is encrypted on the device before it's backed up", async ({ browser }) => {
  const cloud = newCloud();
  const phone = await device(browser, cloud);
  await turnOnSync(phone);
  await addPhoto(phone, "Bash at the lake");
  await expect.poll(() => cloud.files.size).toBe(1);
  const [stored] = [...cloud.files.values()];
  expect(stored.bytes[0]).toBe(1); // vault format version
  expect(stored.bytes.includes(PNG_MAGIC)).toBe(false); // not a readable PNG
  expect(stored.bytes.includes(Buffer.from("image/png"))).toBe(false); // not even its type
  expect(cloud.auth).toEqual(new Set([`Bearer ${await syncCode(phone)}`]));
  await phone.getByRole("button", { name: "Settings" }).click();
  await expect(phone.locator("#backupStatus")).toContainText("Moments backup: 1 file");
  await expect(phone.locator("#backupStatus")).toContainText("Encrypted on this device before upload.");
});

test("a second device linked with the code gets the moment, file and all", async ({ browser }) => {
  const cloud = newCloud();
  const phone = await device(browser, cloud);
  await turnOnSync(phone);
  await expect.poll(() => sealedPart(cloud)).not.toBe("");
  const sealedBefore = sealedPart(cloud);
  await addPhoto(phone, "Bash at the lake");
  await expect.poll(() => cloud.files.size).toBe(1);
  // Let the state with the new moment reach the cloud too (sealed, so wait for the sealed part to change).
  await expect.poll(() => sealedPart(cloud)).not.toBe(sealedBefore);

  const laptop = await device(browser, cloud, await syncCode(phone));
  await laptop.getByRole("button", { name: "Settings" }).click();
  await laptop.getByRole("button", { name: "Link with a code" }).click();
  await expect(laptop.locator("#syncStatus")).toContainText("synced");
  await laptop.keyboard.press("Escape");
  await laptop.getByRole("tab", { name: "Journey" }).click();
  const img = laptop.locator(".moments img");
  await expect(img).toHaveAttribute("alt", "Bash at the lake");
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(80);
});

test("deleting a moment removes its file from the backup", async ({ browser }) => {
  const cloud = newCloud();
  const phone = await device(browser, cloud);
  await turnOnSync(phone);
  await addPhoto(phone, "Bash at the lake");
  await expect.poll(() => cloud.files.size).toBe(1);
  await phone.getByRole("button", { name: /Delete moment from/ }).click();
  await expect.poll(() => cloud.files.size).toBe(0);
});

test("without sync, nothing leaves the device", async ({ browser }) => {
  const cloud = newCloud();
  const phone = await device(browser, cloud);
  await addPhoto(phone, "Bash at the lake");
  await phone.waitForTimeout(500);
  expect(cloud.files.size).toBe(0);
  expect(cloud.state).toBeNull();
});

test("a check-in's picture is backed up encrypted, and removed when the check-in is deleted", async ({ browser }) => {
  const cloud = newCloud();
  const phone = await device(browser, cloud);
  await turnOnSync(phone);
  await logMood(phone, "5 out of 10, Meh", { picture: GIF });
  await expect.poll(() => cloud.files.size).toBe(1);
  const [stored] = [...cloud.files.values()];
  expect(stored.bytes.includes(Buffer.from("GIF89a"))).toBe(false); // not a readable GIF
  await phone.getByRole("button", { name: "Collect" }).click();
  await phone.getByRole("tab", { name: "Journey" }).click();
  await phone.getByRole("button", { name: /Edit mood check-in at/ }).click();
  const del = phone.locator("#moodEdit").getByRole("button", { name: "Delete" });
  await del.click();
  await del.click();
  await expect.poll(() => cloud.files.size).toBe(0);
});

test("check-ins, notes and moments reach the server sealed, and a linked device opens them", async ({ browser }) => {
  const cloud = newCloud();
  const phone = await device(browser, cloud);
  await turnOnSync(phone);
  await logMood(phone, "3 out of 10, Rough", { note: "slept on the beach", sleep: "about 6 hours" });
  await phone.getByRole("button", { name: "Collect" }).click();
  await addPhoto(phone, "Bash at the lake");
  // Wait until the server has the phone's latest save (sync waits a moment after the last change).
  const savedAt = () =>
    phone.evaluate(
      () => (JSON.parse(localStorage.getItem("quest-log-v2") ?? "{}") as { updatedAt?: number }).updatedAt,
    );
  await expect.poll(async () => cloud.state?.updatedAt === (await savedAt()) && sealedPart(cloud) !== "").toBe(true);
  const onServer = JSON.stringify(cloud.state);
  for (const secret of ["slept on the beach", "about 6 hours", "Bash at the lake"])
    expect(onServer).not.toContain(secret);
  expect(onServer).toContain('"moods":[]');
  expect(onServer).toContain("Check off this quest"); // quests stay readable for reminders and Claude

  const laptop = await device(browser, cloud, await syncCode(phone));
  await laptop.getByRole("button", { name: "Settings" }).click();
  await laptop.getByRole("button", { name: "Link with a code" }).click();
  await expect(laptop.locator("#syncStatus")).toContainText("synced");
  await laptop.keyboard.press("Escape");
  await laptop.getByRole("tab", { name: "Journey" }).click();
  await expect(laptop.locator(".log")).toContainText("Mood 3/10 · Rough · Sleep: about 6 hours · slept on the beach");
  await expect(laptop.locator(".moments")).toContainText("Bash at the lake");
});

test("Delete my data removes everything from the server, turns sync off, and keeps it all on the device", async ({
  browser,
}) => {
  const cloud = newCloud();
  const phone = await device(browser, cloud);
  await turnOnSync(phone);
  await addPhoto(phone, "Bash at the lake");
  await expect.poll(() => cloud.files.size).toBe(1);
  await phone.getByRole("button", { name: "Settings" }).click();
  const del = phone.getByRole("button", { name: "Delete my data from the server" });
  await del.click();
  await expect(phone.locator("#syncDelete")).toHaveText("Tap again: delete everything on the server");
  expect(cloud.state).not.toBeNull(); // one tap does nothing
  await phone.locator("#syncDelete").click();
  await expect.poll(() => cloud.state).toBeNull();
  expect(cloud.files.size).toBe(0);
  await expect(phone.getByRole("button", { name: "Turn on sync" })).toBeVisible();
  await expect(phone.locator("#toast")).toContainText("Everything is still here on this device.");
  await phone.keyboard.press("Escape");
  await phone.getByRole("tab", { name: "Journey" }).click();
  await expect(phone.locator(".moments")).toContainText("Bash at the lake");
});
