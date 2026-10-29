// Records the VidMind demo as one uncut take (video only; add narration in an editor): paste a link, notes stream
// in, a citation plays its moment, the check is shown, then On screen and How it was made.
// Usage (web on :3000, API on :8000): node record.mjs <youtube-url>   → prints the .webm path.
// A link processed in the last 24 h is reused instantly; pick a fresh one to show notes streaming in.
import { chromium } from "@playwright/test";

const url = process.argv[2];
if (!url) throw new Error("usage: node record.mjs <youtube-url>");
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: "video", size: { width: 1440, height: 900 } },
  colorScheme: "dark",
});
const page = await context.newPage();
const pause = (s) => page.waitForTimeout(s * 1000);
const glide = async (dy) => {
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, dy / 12), await pause(0.05);
};

await page.goto("http://localhost:3000/");
await page.locator("canvas").first().waitFor({ timeout: 15_000 });
await pause(2);
// 0-10 s: the problem in one action — a long video in, notes out.
await page.getByLabel("Video link").pressSequentially(url, { delay: 25 });
await pause(1);
await page.getByRole("button", { name: /make notes/ }).click();
await page.waitForURL(/\/jobs\//, { timeout: 30_000 });
// 10-30 s: notes stream in, each already checked; the run card counts the seconds.
await page.getByRole("heading", { level: 2 }).first().waitFor({ timeout: 60_000 });
await pause(6);
await glide(500);
await pause(2);
// 30-60 s: trust — hover a citation (the quoted words, "Checked"), click it (plays that second).
const cite = page.locator("button.cite").first();
await cite.scrollIntoViewIfNeeded();
await cite.hover();
await pause(3);
await cite.click();
await pause(6);
await page.keyboard.press("Escape");
// 60-75 s: what the check threw out, at the end of the article.
await page.locator("details").filter({ hasText: /Removed|checked/ }).first().scrollIntoViewIfNeeded();
await page.locator("details").filter({ hasText: /Removed|checked/ }).first().locator("summary").click();
await pause(4);
// 75-105 s: On screen — each slide with what the notes say about it.
await page.getByRole("tab", { name: /On screen/ }).click();
await pause(3);
await glide(700);
await pause(4);
// 105-135 s: How it was made — the real seconds, the models, the steps.
await page.getByRole("tab", { name: "How it was made" }).click();
await page.evaluate(() => window.scrollTo(0, 0));
await pause(5);
await glide(900);
await pause(4);
await glide(900);
await pause(3);

const path = await page.video().path();
await context.close();
await browser.close();
console.log(path);
