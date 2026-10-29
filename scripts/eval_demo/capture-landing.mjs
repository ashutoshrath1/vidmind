// Captures the landing page's product images from the real sample result, so they show the product as it is.
// Usage (web on :3000, API on :8000): node capture-landing.mjs
// Writes web/public/landing/{notes,diagram}.webp and prints their sizes (set them as width/height where they're used).
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const OUT = "../../web/public/landing";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light", deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/jobs/sample", { waitUntil: "networkidle" });
await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 20_000 });
// Floating bars and the scroll-edge fade would cover crops: hide everything fixed or sticky.
const hideFloating = () => page.evaluate(() => {
  for (const el of document.querySelectorAll("body *"))
    if (["fixed", "sticky"].includes(getComputedStyle(el).position)) el.style.visibility = "hidden";
});

const shot = async (locator, name, clipHeight) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await hideFloating();
  const box = await locator.boundingBox();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true,
    clip: { x: box.x - 24, y: box.y - 24 + (await page.evaluate(() => scrollY)), width: box.width + 48, height: Math.min(clipHeight ?? box.height, box.height) + 48 } });
  // This machine's ffmpeg has no WebP encoder; Pillow (in the API's environment) does.
  const size = execFileSync("uv", ["run", "--project", "../../api", "python", "-c",
    `from PIL import Image; im = Image.open("${OUT}/${name}.png"); im.thumbnail((1200, 4000)); im.save("${OUT}/${name}.webp", quality=84); print(*im.size)`]).toString().trim();
  execFileSync("rm", [`${OUT}/${name}.png`]);
  console.log(name, size);
};

await page.locator("[data-diagram] svg").waitFor();
await shot(page.locator("[data-diagram]"), "diagram");
const chapter = page.locator("article h2").filter({ hasNotText: /takeaways|removed|share/i }).first();
await shot(chapter.locator("xpath=ancestor::section[1]"), "notes", 620);
await b.close();
