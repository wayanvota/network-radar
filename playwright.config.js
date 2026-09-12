import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/support/start-stack.mjs",
    port: 5178,
    reuseExistingServer: false
  }
});
