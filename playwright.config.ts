import { defineConfig, devices } from "@playwright/test";

// Smoke tests of the built site with the real audio (just fetch-audio, then
// just build). They run in CI; locally they need Playwright's browsers.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4173/longquiet/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm exec -- vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/longquiet/",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
