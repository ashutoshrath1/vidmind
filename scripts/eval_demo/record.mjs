// Records the Taskly demo (video only); make_mode_fixtures.py adds the narration at the same times.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";

const server = spawn("python3", ["-m", "http.server", "4173", "-d", "../demo_app"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: "video", size: { width: 1280, height: 720 } } });
const page = await context.newPage();
const t0 = Date.now(), at = (s) => new Promise((r) => setTimeout(r, Math.max(0, t0 + s * 1000 - Date.now())));
await page.goto("http://localhost:4173");
const box = page.getByPlaceholder("What needs doing?");
await at(3); await box.pressSequentially("Buy milk", { delay: 80 }); await page.getByRole("button", { name: "Add" }).click();
await at(9); await box.pressSequentially("Call the bank", { delay: 80 }); await box.press("Enter");
await at(15); await page.getByLabel("Buy milk").check();
await at(20); await page.getByRole("button", { name: "Clear completed" }).click();
await at(26);
const path = await page.video().path();
await context.close(); await browser.close(); server.kill();
console.log(path);
