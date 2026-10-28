// End-to-end checks of the running app (web on :3000, API on :8000): npx playwright test -c e2e.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1, // one browser at a time: the jobs share one API and its Muse budget
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", browserName: "chromium", viewport: { width: 1440, height: 900 } },
});
