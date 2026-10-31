// Records the VidMind demo as one uncut take (video only; add your voice in any editor), following
// docs/DEMO_SCRIPT.md: paste a link, notes stream in and every ✓ lights up, a citation shows its slide and plays
// its moment, the check line, On screen, How it was made, Copy as Markdown.
// Usage (web on :3000, API on :8000): node record.mjs <youtube-url>   → prints the .webm path.
// A link processed in the last 24 h is reused instantly; pick a fresh ~10-minute one to show notes streaming in.
import { chromium } from "@playwright/test";

const url = process.argv[2];
if (!url) throw new Error("usage: node record.mjs <youtube-url>");
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: "video", size: { width: 1440, height: 900 } },
  colorScheme: "dark",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const pause = (s) => page.waitForTimeout(s * 1000);
const glide = async (dy) => {
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, dy / 12), await pause(0.05);
};

// 0-8 s: the home page, all on one screen.
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" }); // typing before the page is live is lost
await pause(3);
// 8-15 s: paste a link.
await page.getByLabel("Video link").pressSequentially(url, { delay: 25 });
await pause(1.5); // the link check
await page.getByRole("button", { name: /make notes/ }).click();
await page.waitForURL(/\/jobs\//, { timeout: 30_000 });
// 15-30 s: sections stream in under the live "Now" line; when the last lands, every ✓ lights up in order.
await page.locator("button.cite").first().waitFor({ timeout: 90_000 });
await page.waitForFunction(() => document.querySelectorAll(".prove").length > 0, null, { timeout: 120_000 }).catch(() => {});
await pause(2.5);
// 30-50 s: trust. Hover a ✓ that cites the screen: the slide it was checked against. Click: the player at that second.
const cite = page.locator("button.cite", { hasText: "on screen" }).first().or(page.locator("button.cite").first()).first();
await cite.scrollIntoViewIfNeeded();
await glide(-120);
await cite.hover();
await pause(3.5);
await cite.click();
await pause(5);
await page.mouse.move(700, 450);
// 50-60 s: the end of the article: how many claims were checked, and any removed with the reason.
await page.getByText(/claims checked against the video/).scrollIntoViewIfNeeded();
await pause(4);
// 60-85 s: On screen, each slide explained.
await page.getByRole("tab", { name: /On screen/ }).click();
await page.evaluate(() => window.scrollTo(0, 0));
await pause(3);
await glide(700);
await pause(4);
// 85-115 s: How it was made: "N notes verified in X s", the steps and models, the chart.
await page.getByRole("tab", { name: "How it was made" }).click();
await page.evaluate(() => window.scrollTo(0, 0));
await pause(5);
await glide(900);
await pause(4);
// 115-125 s: take it with you: Copy as Markdown.
await page.getByRole("tab", { name: "Notes" }).click();
await page.evaluate(() => window.scrollTo(0, 0));
await pause(1);
await page.getByRole("button", { name: /Copy/ }).first().click();
await pause(3);

const path = await page.video().path();
await context.close();
await browser.close();
console.log(path);
