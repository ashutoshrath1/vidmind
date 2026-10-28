// Home page flows: node flow.mjs link|file
import { chromium } from "@playwright/test";
const mode = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 200)));
p.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
await p.goto("http://localhost:3000/", { waitUntil: "networkidle" });
if (mode === "link") {
  await p.fill("#source", "https://www.youtube.com/watch?v=-RDyEFvnTXI");
  await p.getByRole("button", { name: /make notes/i }).click();
} else {
  const [chooser] = await Promise.all([p.waitForEvent("filechooser", { timeout: 5000 }), p.getByRole("button", { name: "Add a file" }).click()]);
  await chooser.setFiles("../fixtures/demo.mp4");
  await p.waitForTimeout(1500);
  console.log("after choose:", (await p.locator("form").innerText()).replace(/\n/g, " | ").slice(0, 200));
  await p.getByRole("button", { name: /make notes/i }).click();
}
for (let i = 0; i < 20; i++) {
  await p.waitForTimeout(500);
  if (p.url().includes("/jobs/")) { console.log("navigated after", (i + 1) * 0.5, "s:", p.url()); break; }
  if (i === 19) console.log("stuck on", p.url(), "|", (await p.locator("form").innerText()).replace(/\n/g, " | ").slice(0, 200));
}
await b.close();
