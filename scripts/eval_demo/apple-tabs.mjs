// On screen and How it was made tabs, light+dark, desktop+phone: node apple-tabs.mjs <outdir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch();
for (const scheme of ["light", "dark"]) for (const [w, h, tag] of [[1440, 900, "desk"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
  p.on("pageerror", (e) => console.log(scheme, tag, "pageerror", e.message.slice(0, 160)));
  await p.goto("http://localhost:3000/jobs/sample", { waitUntil: "networkidle" });
  for (const [tab, name] of [["On screen", "onscreen"], ["How it was made", "made"]]) {
    await p.getByRole("tab", { name: tab }).click();
    await p.waitForTimeout(1200);
    console.log(scheme, tag, name, "side scroll:", await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await p.screenshot({ path: `${out}/apple-tabs-${name}-${scheme}-${tag}.png`, fullPage: true });
  }
  if (tag === "desk") {
    await p.getByRole("tab", { name: "On screen" }).click();
    await p.getByRole("button", { name: /full size/ }).first().click();
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/apple-tabs-lightbox-${scheme}-${tag}.png` });
  }
  await p.close();
}
await b.close();
