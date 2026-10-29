import { defineConfig, devices } from "@playwright/test";

/** Chromium only: a fake microphone (a steady tone) so in-app recording can be tested without hardware or prompts. */
const fakeMic = {
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...fakeMic } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...fakeMic } },
    // Safari's engine on an iPhone-sized screen: most people who get Quest Log use an iPhone (#96).
    // WebKit has no fake microphone, so the in-app recording test runs on Chromium only.
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: "npm run build && node scripts/serve-static.mjs",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
