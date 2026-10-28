// The add-file flow in installed Google Chrome (not the bundled test browser), with console errors.
import { chromium } from "@playwright/test";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on("console", (m) => ["error", "warning"].includes(m.type()) && console.log(m.type(), m.text().slice(0, 300)));
p.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 300)));
await p.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const btn = p.getByRole("button", { name: "Add a file" });
console.log("button:", await btn.isVisible(), await btn.isEnabled());
const hit = await p.evaluate(() => { const r = [...document.querySelectorAll("button")].find((b) => b.textContent === "Add a file").getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el?.outerHTML.slice(0, 160); });
console.log("element at its centre:", hit);
const chooser = p.waitForEvent("filechooser", { timeout: 4000 }).then(() => "file picker opened").catch(() => "NO file picker");
await btn.click();
console.log(await chooser);
await b.close();
