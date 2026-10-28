// Captures the landing page's product images from real results (dark theme), so they show the product as it is.
// Usage (web on :3000, API on :8000): node capture-landing.mjs <meeting-job-id> <demo-job-id>
// Writes web/public/landing/*.png, then converts to WebP; also copies the sample's run log for the replay section.
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [meeting, demo] = process.argv.slice(2);
const OUT = "../../web/public/landing";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", deviceScaleFactor: 2 });
const open = async (path) => {
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  await page.getByText(/notes verified/).waitFor({ timeout: 20_000 });
  await page.addStyleTag({ content: "header { display: none !important; }" }); // the sticky header would cover crops
};
const shot = async (locator, name) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await locator.screenshot({ path: `${OUT}/${name}.png` });
  // This machine's ffmpeg has no WebP encoder; Pillow (in the API's environment) does.
  execFileSync("uv", ["run", "--project", "../../api", "python", "-c",
    `from PIL import Image; im = Image.open("${OUT}/${name}.png"); im.thumbnail((1200, 4000)); im.save("${OUT}/${name}.webp", quality=82)`]);
  execFileSync("rm", [`${OUT}/${name}.png`]);
  console.log("captured", name);
};

await open("/jobs/sample");
await shot(page.locator("article").first(), "notes");
await page.locator("[data-diagram] svg").waitFor();
await shot(page.locator("[data-diagram]").locator("xpath=.."), "diagram");
await shot(page.getByRole("region", { name: "Key takeaways" }).locator("ol").first(), "factcheck");
const post = page.getByRole("img", { name: "The image that will be posted" });
await post.waitFor({ timeout: 20_000 });
await shot(post, "post");
await page.getByRole("tab", { name: /Keyframes/ }).click();
await page.getByRole("button", { name: /Keyframe at/ }).first().click();
const frame = page.getByRole("button", { name: /click a spot to ask about it/ });
await frame.click({ position: { x: 230, y: 150 } });
await page.getByRole("button", { name: "Ask", exact: true }).click();
await page.getByText(/Checked against the video|Not in this video/).last().waitFor({ timeout: 60_000 });
await shot(frame.locator("xpath=.."), "point");

await open(`/jobs/${meeting}`);
await shot(page.locator("h3", { hasText: "Decisions" }).locator("xpath=../.."), "actions");
await open(`/jobs/${demo}`);
await page.getByRole("tab", { name: /Tests/ }).click();
await shot(page.locator("h3").first().locator("xpath=.."), "tests");

copyFileSync("../../samples/trace.jsonl", `${OUT}/trace.jsonl`);
await b.close();
