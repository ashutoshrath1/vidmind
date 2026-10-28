// Frame cost of the home hero: draw calls from the renderer, and frame intervals over 3 s, on the real GPU.
import { chromium } from "playwright";
const theme = process.argv[2] ?? "dark";
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForFunction(() => window.__vidmindGl, null, { timeout: 20000 });
await p.waitForTimeout(2500); // past the intro
const out = await p.evaluate(async () => {
  const gl = window.__vidmindGl;
  const ctx = gl.getContext();
  const dbg = ctx.getExtension("WEBGL_debug_renderer_info");
  const gpu = dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?";
  const times = [];
  let last = performance.now();
  await new Promise((done) => {
    const tick = (t) => { times.push(t - last); last = t; times.length < 180 ? requestAnimationFrame(tick) : done(); };
    requestAnimationFrame(tick);
  });
  times.sort((a, b) => a - b);
  // Is anything on screen? A pipeline fault can leave the canvas empty while frames still look fast.
  const c = Object.assign(document.createElement("canvas"), { width: 200, height: 120 });
  const x = c.getContext("2d"); x.drawImage(document.querySelector("canvas"), 0, 0, 200, 120);
  const px = x.getImageData(0, 0, 200, 120).data; let alpha = 0;
  for (let i = 3; i < px.length; i += 4) alpha += px[i];
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return { gpu, calls: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs?.length,
    textures: gl.info.memory.textures, buffer: `${ctx.drawingBufferWidth}x${ctx.drawingBufferHeight}`,
    avgMs: avg.toFixed(1), p95Ms: times[Math.floor(times.length * 0.95)].toFixed(1), slowFrames: times.filter((t) => t > 20).length, visible: (alpha / (px.length / 4)).toFixed(1) };
});
console.log(theme, JSON.stringify(out));
await b.close();
