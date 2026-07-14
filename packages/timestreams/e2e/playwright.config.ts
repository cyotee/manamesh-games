import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
  },
  // Prefer an already-running `yarn dev:frontend`. Set E2E_START_SERVER=1 to spawn Vite.
  webServer: process.env.E2E_START_SERVER
    ? {
        command: "yarn workspace @manamesh/frontend dev --port 3000 --strictPort",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
        cwd: process.cwd() + "/../..",
      }
    : undefined,
});
