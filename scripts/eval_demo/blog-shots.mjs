// Notes as a blog, with a mocked article (until the sample is regenerated): node blog-shots.mjs <outdir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  for (const [name, w, h] of [["desk", 1440, 900], ["phone", 390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    p.on("pageerror", (e) => console.log(scheme, name, "pageerror", e.message.slice(0, 160)));
    await p.route("**/jobs/sample/result", async (route) => {
      const r = await (await route.fetch()).json();
      r.chapters.forEach((c, i) => {
        c.hook = `Here is why ${c.title.toLowerCase()} matters more than it looks.`;
        c.article = [
          { text: c.notes.slice(0, 2).map((n) => n.text).join(" "), cites: [0, 1] },
          { text: c.notes.slice(2).map((n) => n.text).join(" ") || c.summary, cites: [2, 3] },
        ];
        c.image_url = `frames/${i}.jpg`;
        c.image_alt = `Illustration for ${c.title}`;
      });
      await route.fulfill({ json: r });
    });
    await p.goto("http://localhost:3000/jobs/sample", { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    console.log(scheme, name, "side scroll:", await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await p.screenshot({ path: `${out}/blog2-${scheme}-${name}-top.png` });
    await p.mouse.wheel(0, h * 1.8);
    await p.waitForTimeout(800);
    console.log(scheme, name, "bar:", await p.locator("header p[aria-live]").textContent());
    await p.screenshot({ path: `${out}/blog2-${scheme}-${name}-mid.png` });
    await p.close();
  }
}
await b.close();
