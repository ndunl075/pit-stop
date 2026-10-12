import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  outputDir: "./test-results/visual",
  snapshotPathTemplate: "{testDir}/baselines/{platform}/{arg}{ext}",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      threshold: 0.15,
      maxDiffPixels: 50,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:1427",
    browserName: "chromium",
    headless: true,
    viewport: { width: 720, height: 405 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-lcd-text",
      ],
    },
  },
  webServer: {
    command: "pnpm dev:visual",
    url: "http://127.0.0.1:1427",
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
