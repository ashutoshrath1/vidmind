// Home and result pages in light and dark, with console errors: node themes.mjs <outdir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const scheme of ["light", "dark"]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  p.on("pageerror", (e) => console.log(scheme, "pageerror", e.message.slice(0, 160)));
  p.on("console", (m) => m.type() === "error" && console.log(scheme, "console", m.text().slice(0, 160)));
  await p.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await p.waitForTimeout(3500); // mid-loop: cards out, particles flying
  console.log(scheme, "webgl canvas:", await p.locator("canvas").count());
  await p.screenshot({ path: `${out}/home-${scheme}.png` });
  await p.goto("http://localhost:3000/jobs/sample", { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/job-${scheme}.png` });
  await p.close();
}
await b.close();
