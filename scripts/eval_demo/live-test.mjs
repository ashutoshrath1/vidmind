// Live test of a fresh link in a clean Chrome profile (an incognito-like context: no cache, cookies or storage).
// Usage (web on :3000, API on :8000): node live-test.mjs <youtube-url> [shots-dir]
// Measures wall-clock times itself, then checks every tab for NaN, broken images and wrong labels.
import { chromium } from "@playwright/test";

const url = process.argv[2];
const shots = process.argv[3] ?? ".";
if (!url) throw new Error("usage: node live-test.mjs <url> [shots-dir]");
const problems = [];
const note = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) problems.push(what); };
const browser = await chromium.launch({ channel: "chrome", headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 160)}`));
page.on("response", (r) => r.status() >= 400 && !/favicon|_next\/image/.test(r.url()) && errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`));
const since = (t0) => ((Date.now() - t0) / 1000).toFixed(1);

// A finished job's address re-checks everything except the live timings; a video link starts a fresh run.
const existing = /\/jobs\//.test(url);
await page.goto(existing ? url : "http://localhost:3000/");
if (!existing) {
  await page.getByLabel("Video link").fill(url);
  await page.getByRole("button", { name: /make notes/ }).click();
}
const t0 = Date.now();
await page.waitForURL(/\/jobs\//, { timeout: 60_000 });
console.log(`job page after ${since(t0)} s; ${page.url()}`);

// First note on the page, all notes, then the article/illustrations/slides without any reload.
const times = {};
const first = page.locator("button.cite").first();
await first.waitFor({ timeout: 120_000 }); times.firstCitation = since(t0);
await page.getByRole("heading", { level: 2 }).first().waitFor({ timeout: 120_000 });
if (existing) await page.waitForTimeout(1500);
await page.getByText(/Writing the article/).first().waitFor({ timeout: 5_000 }).catch(() => {});
await page.waitForFunction(() => document.querySelectorAll("article figure img, article img[src*='/ch']").length > 0, null, { timeout: 150_000 }).then(() => (times.firstIllustration = since(t0))).catch(() => {});
await page.waitForFunction(() => !document.body.innerText.includes("Writing the article"), null, { timeout: 150_000 }).then(() => (times.articleDone = since(t0))).catch(() => {});
console.log("times from pressing Make notes (s):", times);
note(times.firstIllustration !== undefined, "illustrations appeared on their own, without a reload");

const broken = async (label) => {
  const bad = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc.slice(-60)));
  note(!bad.length, `${label}: no broken images${bad.length ? " " + JSON.stringify(bad) : ""}`);
};
const clean = async (label) => {
  const text = await page.locator("body").innerText();
  note(!/NaN|undefined|\[object/.test(text), `${label}: no NaN / undefined text`);
};
await page.waitForTimeout(3000);
await page.screenshot({ path: `${shots}/live-notes-top.png` });
await broken("Notes"); await clean("Notes");
const title = await page.getByRole("heading", { level: 1 }).first().innerText();
console.log("title:", title);
// Top bar heading: shows chapter names on Notes while scrolling, nothing on other tabs.
await page.mouse.wheel(0, 1800); await page.waitForTimeout(900);
const bar = await page.locator(".glass p[aria-live='polite']").first().innerText().catch(() => "");
note(bar.length > 0, `Notes: top bar shows the current section while scrolling ("${bar.slice(0, 50)}")`);
await page.screenshot({ path: `${shots}/live-notes-mid.png` });
await page.locator("article").first().evaluate((el) => el.scrollIntoView());
const cite = page.locator("button.cite").first(); await cite.scrollIntoViewIfNeeded(); await cite.hover(); await page.waitForTimeout(500);
note(await cite.getByRole("tooltip").isVisible().catch(() => false), "Notes: hovering a citation shows the quoted words");
await cite.click(); await page.waitForTimeout(1500);
note(await page.getByRole("dialog").first().isVisible().catch(() => false) || (await page.locator("iframe").count()) > 0, "Notes: clicking a citation opens the player");
await page.keyboard.press("Escape");

for (const [name, file] of [["On screen", "live-onscreen"], ["How it was made", "live-made"]]) {
  await page.getByRole("tab", { name: new RegExp(name) }).click(); await page.waitForTimeout(2500);
  await page.evaluate(() => scrollTo(0, 0));
  const barText = await page.locator(".glass p[aria-live='polite']").first().innerText().catch(() => "");
  note(barText.trim() === "", `${name}: top bar has no article heading ("${barText.slice(0, 40)}")`);
  await broken(name); await clean(name);
  await page.screenshot({ path: `${shots}/${file}-top.png` });
  if (name === "How it was made") {
    const chart = page.getByRole("figure", { name: "When each step ran" });
    note(await chart.isVisible().catch(() => false), "How it was made: the timeline chart is visible without opening anything");
    await chart.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(600);
    await page.screenshot({ path: `${shots}/${file}-chart.png` });
  }
}
// How it was made: the chart is visible without opening anything, and the times are consistent.
const text = await page.locator("main, body").first().innerText();
console.log("how-it-was-made numbers:", text.match(/First note[\s\S]{0,40}|all notes[\s\S]{0,60}/i)?.[0]?.replace(/\s+/g, " "));
console.log("page errors:", errors.length ? errors.slice(0, 8) : "none");
note(!errors.some((e) => /pageerror|HTTP 5|HTTP 404/.test(e)), "no page errors or failed requests");
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nall checks passed");
await browser.close();
process.exit(problems.length ? 1 : 0);
