// Screenshots of the app: node shot.mjs <url> <out.png> [width] [height] [click-text] [hover-selector]
import { chromium } from "@playwright/test";
const [url, out, w = "1440", h = "900", click = "", hover = ""] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
if (click) { await p.getByRole("tab", { name: new RegExp(click) }).click(); await p.waitForTimeout(800); }
if (hover) { const el = p.locator(hover).first(); await el.scrollIntoViewIfNeeded(); await el.hover(); await p.waitForTimeout(400); }
await p.screenshot({ path: out });
console.log(await p.evaluate(() => document.documentElement.scrollHeight));
await b.close();
