// Result page in light and dark, desktop top/mid and phone: node apple-notes-shots.mjs <outdir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  for (const [name, w, h] of [["desk", 1440, 900], ["phone", 390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    p.on("pageerror", (e) => console.log(scheme, name, "pageerror", e.message.slice(0, 160)));
    await p.goto("http://localhost:3000/jobs/sample", { waitUntil: "networkidle" });
    await p.waitForTimeout(2000);
    console.log(scheme, name, "side scroll:", await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await p.screenshot({ path: `${out}/apple-notes-${scheme}-${name}-top.png` });
    await p.mouse.wheel(0, h * 1.6);
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/apple-notes-${scheme}-${name}-mid.png` });
    if (name === "desk") {
      await p.locator(".cite").nth(3).click();
      await p.waitForTimeout(900);
      await p.screenshot({ path: `${out}/apple-notes-${scheme}-${name}-player.png` });
    }
    await p.close();
  }
}
await b.close();
