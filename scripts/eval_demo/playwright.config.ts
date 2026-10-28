// Runs the tests VidMind generated from the demo video against the app the video was recorded from.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./generated",
  timeout: 15_000,
  reporter: [["json", { outputFile: "results.json" }]],
  use: { baseURL: "http://localhost:4173", browserName: "chromium" },
  webServer: { command: "python3 -m http.server 4173 -d ../demo_app", url: "http://localhost:4173", reuseExistingServer: true },
});
