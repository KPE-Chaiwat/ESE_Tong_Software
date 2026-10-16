import { defineConfig, devices } from "@playwright/test";

// UI mode (QA-001): the Vite dev server runs with VITE_FAKE_IPC=manual (the fake without simulation), so the app talks to the
// scriptable fake IPC (`window.__ESEFACT_FAKE_IPC__`) instead of Tauri. Integration mode (real Tauri
// window over WebView2/CDP against a simulated slave) is a separate, later setup.
//
// The "perf" project is run on its own (`pnpm --filter @esefact/e2e test:perf`, one worker) so that
// long-task measurements are not disturbed by other workers using the CPU.
// The "integration" project drives the real desktop app (see e2e/integration). It starts its own
// processes, so the Vite web server is not started when only that project runs.
const integrationOnly = process.argv.some((a) => a === "--project=integration" || a === "integration");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    permissions: ["clipboard-read", "clipboard-write"],
    actionTimeout: 10_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "ui",
      outputDir: "./test-results/ui",
      testIgnore: /perf\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "perf",
      outputDir: "./test-results/perf",
      testMatch: /perf\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "integration",
      testDir: "./tests-integration",
      outputDir: "./test-results/integration",
      fullyParallel: false,
      timeout: 120_000,
      expect: { timeout: 10_000 },
      use: { screenshot: "off", trace: "off" },
    },
  ],
  ...(integrationOnly
    ? {}
    : {
        webServer: {
          command: "pnpm --filter @esefact/desktop dev:web",
          url: "http://localhost:1420",
          // Never reuse: a server started without VITE_FAKE_IPC=manual would silently run against Tauri.
          reuseExistingServer: false,
          timeout: 120_000,
          env: { VITE_FAKE_IPC: "manual" },
        },
      }),
});
