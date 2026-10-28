// node shot2.mjs <url> <out-prefix>: home-style single shot or job page with steps open and the behind-the-scenes tab.
import { chromium } from "@playwright/test";
const [url, out] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(3000);
await p.screenshot({ path: `${out}-a.png` });
const steps = p.getByRole("button", { name: "Show steps" });
if (await steps.count()) {
  await steps.click();
  await p.waitForTimeout(400);
  await p.locator('[aria-current], li [tabindex="0"]').nth(2).hover().catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}-b.png`, clip: { x: 0, y: 60, width: 1440, height: 340 } });
  await p.getByRole("tab", { name: /Behind/ }).click();
  await p.waitForTimeout(800);
  await p.locator('[aria-label="The run, step by step"]').scrollIntoViewIfNeeded();
  await p.locator('[aria-label="The run, step by step"]').screenshot({ path: `${out}-c.png` });
}
await b.close();
