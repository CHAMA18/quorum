import { defineConfig, devices } from "playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "bun run dev",
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
