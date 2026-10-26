// Shared steps for the end-to-end tests.
import { expect, type Page } from "@playwright/test";

/** Logs a check-in through the 📝 Log button: a mood ("6 out of 10, Okay"), and optionally more. */
export async function logMood(
  page: Page,
  mood: string,
  { note, steps = [], sleep, picture }: { note?: string; steps?: string[]; sleep?: string; picture?: string } = {},
) {
  await page.getByRole("button", { name: "📝 Log", exact: true }).click();
  const dlg = page.locator("#logDialog");
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: mood }).click();
  if (steps.length || sleep) {
    await dlg.getByText("More: anxiety, energy, body, focus, sleep, pain").click();
    for (const s of steps) await dlg.getByRole("button", { name: s }).click();
    if (sleep) await dlg.getByLabel(/^Sleep/).fill(sleep);
  }
  if (note) await dlg.getByLabel(/^Note/).fill(note);
  if (picture) {
    await dlg.getByLabel(/^Picture or GIF/).setInputFiles(picture);
    await expect(dlg.locator("#logPreview")).toBeVisible();
  }
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dlg).toBeHidden();
}
