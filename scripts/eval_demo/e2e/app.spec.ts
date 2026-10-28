import { expect, test } from "@playwright/test";

// Processed fresh (paid, ~$0.45) the first time after a pipeline version change; reused for free afterwards.
const CACHED = "https://www.youtube.com/watch?v=Xrgk023l4lI";
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("the hero fits the first screen: headline, input and the 3D scene, with the footer at the end", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Notes with proof.");
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  await expect(page.getByLabel("Video link")).toBeInViewport();
  expect(await noSideScroll(page)).toBe(true);
  await expect(page.getByText("Built for the Meta AI Developer Hackathon, 2026 by Ashutosh Rath")).toBeAttached();
  await expect(page.getByRole("img", { name: /glass prism/ })).toBeVisible();
});

test("Add a file opens the picker and an upload reaches the result page", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add a file" }).click();
  await (await chooser).setFiles("../fixtures/demo.mp4");
  await expect(page.getByText("0:31 long")).toBeVisible();
  await page.getByRole("button", { name: "Make notes" }).click();
  await expect(page).toHaveURL(/\/jobs\/\w+/, { timeout: 15_000 });
});

test("a pasted link needs one click, which says what it confirms", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveCount(1, { timeout: 15_000 }); // hydrated: a value typed earlier can be reset
  await page.getByLabel("Video link").fill(CACHED);
  await expect(page.getByText("By continuing, you confirm you own it")).toBeVisible();
  await page.getByRole("button", { name: "I have the rights — make notes" }).click();
  await expect(page).toHaveURL(/\/jobs\/\w+/, { timeout: 15_000 }); // a fresh run the first time, reused after
});


test.describe("result page", () => {
  // The saved sample (a real Muse run of a 4:44 video): stable and free, unlike processing a link per test.
  test.beforeEach(async ({ page }) => {
    await page.goto("/jobs/sample");
    await expect(page.getByText(/notes verified/)).toBeVisible({ timeout: 15_000 });
  });

  test("checked notes, under 11 s, one screen tall, no Lecture chip", async ({ page }) => {
    const total = await page.getByText(/^\d+(\.\d)? s$/).first().innerText();
    expect(parseFloat(total)).toBeLessThan(11);
    await expect(page.getByText("Lecture", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(900); // one page scroll, no inner columns
    expect(await noSideScroll(page)).toBe(true);
  });

  test("diagram first, then takeaways with proof pills", async ({ page }) => {
    const highlights = page.getByRole("region", { name: "Key takeaways" });
    await expect(highlights.locator("[data-diagram] svg")).toBeVisible({ timeout: 15_000 });
    const diagramY = (await highlights.locator("[data-diagram]").boundingBox())!.y;
    const takeawaysY = (await highlights.getByRole("heading", { name: "Key takeaways" }).boundingBox())!.y;
    expect(diagramY).toBeLessThan(takeawaysY);
    const pill = highlights.locator("ol [data-seek]").first(); // a takeaway's pill (the per-box proof list is folded)
    await pill.hover();
    await expect(pill.getByRole("tooltip")).toBeVisible();
  });

  test("compact run card: segmented step bar with fact cards, one Copy .md, no banner or language picker", async ({ page }) => {
    await expect(page.getByRole("progressbar", { name: "Finished" })).toBeVisible();
    const station = page.getByRole("listitem").filter({ hasText: "Transcript" }).locator("[tabindex='0']").first();
    await station.hover();
    await expect(station.getByRole("tooltip")).toContainText(/timed sentences|subtitles/);
    await expect(page.getByRole("button", { name: /Hide steps|Show steps/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy .md" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download .md" })).toHaveCount(0);
    await expect(page.getByText(/analysed live on/)).toHaveCount(0);
    await expect(page.getByText("Read in")).toHaveCount(0);
  });

  test("tabs: keyframes, behind the scenes", async ({ page }) => {
    await page.getByRole("tab", { name: /Keyframes/ }).click();
    await expect(page.getByText("Tap a frame for its text")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Ask the video" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Behind the scenes" }).click();
    const chart = page.getByRole("region", { name: "The run, step by step" });
    await expect(chart.getByText("Notes", { exact: true })).toBeVisible();
    await expect(chart.getByText("Transcript", { exact: true })).toBeVisible();
  });

  test("models are open by default; models are named from the run log", async ({ page }) => {
    const panel = page.getByRole("region", { name: "Models in this video" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("muse-spark-1.2");
    await expect(panel).toContainText("muse-voice-transcribe");
    await expect(panel).toContainText("sam-3.1");
  });

  test("replay takes about 5 s", async ({ page }) => {
    await page.getByRole("button", { name: "↻ Replay" }).click();
    const started = Date.now();
    await expect(page.getByRole("button", { name: "↻ Replay" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "↻ Replay" })).toBeVisible({ timeout: 10_000 });
    expect((Date.now() - started) / 1000).toBeGreaterThan(3.5);
  });
});

test("the finished example is a Muse run with a diagram and takeaways", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Example", exact: true }).click();
  await expect(page.getByText("Precomputed sample")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-diagram] svg")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Models in this video" })).toContainText("muse-spark");
});

test("the theme switch turns on mission control and remembers it; the hero is a WebGL scene", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // set before paint, from localStorage
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--lightbox").trim())).toBe("#04050d");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("home → result → VidMind logo shows the home page again, and stays there", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveCount(1, { timeout: 15_000 }); // hydrated: a value typed earlier can be reset
  await page.getByLabel("Video link").fill(CACHED);
  await page.getByRole("button", { name: /make notes/ }).click();
  await expect(page).toHaveURL(/\/jobs\//, { timeout: 30_000 });
  await page.getByRole("link", { name: "VidMind home" }).first().click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(3500); // past the navigation safety net, which must not bounce back
  await expect(page).toHaveURL("/");
  expect(await page.locator("main").evaluate((m) => getComputedStyle(m).opacity)).toBe("1");
  // The finished notes are listed, and the box takes another video (it used to stay stuck on "Opening the video").
  await expect(page.getByRole("navigation", { name: "Your recent notes" })).toContainText("ago");
  await expect(page.getByLabel("Video link")).toHaveValue("");
  await page.getByLabel("Video link").fill(CACHED);
  await page.getByRole("button", { name: /make notes/ }).click();
  await expect(page).toHaveURL(/\/jobs\//, { timeout: 30_000 });
});

test("landing: real product images, scroll-replayed run, slider, FAQ, and paste-anywhere", async ({ page }) => {
  await page.goto("/about");
  for (const name of ["Notes with proof", "The diagram it explains"]) {
    const img = page.getByRole("img", { name: new RegExp(`^${name}: a real VidMind result`) });
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  }
  const chart = page.getByRole("region", { name: "The run, step by step" });
  await chart.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  await expect(chart.getByText("Notes", { exact: true })).toBeVisible();
  const slider = page.getByLabel("How many hours of video do you watch a week?");
  await slider.fill("10");
  await expect(page.getByText(/7 h 50 min/)).toBeVisible(); // 10 h x 47 min
  await page.getByText("What happens to my video?").click();
  await expect(page.getByText(/deleted after 24 hours/).first()).toBeVisible();
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveCount(1, { timeout: 15_000 }); // hydrated: the paste listener is on
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text", "https://www.youtube.com/watch?v=WeY-ZnRofsk");
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });
  await expect(page.getByLabel("Video link")).toHaveValue("https://www.youtube.com/watch?v=WeY-ZnRofsk");
});

test("screen text: search a slide word, see it marked, click plays that moment; no match says so", async ({ page }) => {
  await page.route("https://www.youtube-nocookie.com/embed/**", (r) => r.fulfill({ contentType: "text/html",
    body: "<script>window.got = []; addEventListener('message', (e) => got.push(JSON.parse(e.data)));</script>" }));
  await page.goto("/jobs/sample");
  await page.getByRole("tab", { name: /Keyframes/ }).click({ timeout: 15_000 });
  const vault = page.getByRole("region", { name: "Screen text" });
  await vault.getByLabel("Search what was on screen").fill("eureka"); // on the slide at 1:28 only
  await expect(vault.getByText(/^1 of \d+ frames match$/)).toBeVisible();
  await expect(vault.locator("mark")).toHaveText("Eureka");
  await vault.getByRole("button", { name: "Play from 1:28" }).click();
  const player = page.frame({ url: /youtube-nocookie/ })!;
  await expect.poll(() => player.evaluate(() => (window as unknown as { got: { func: string; args: unknown[] }[] }).got))
    .toContainEqual({ event: "command", func: "seekTo", args: [87.83, true] });
  await vault.getByLabel("Search what was on screen").fill("kafka");
  await expect(vault.getByText("Nothing on screen matches “kafka”.")).toBeVisible();
  await expect(vault.getByRole("button", { name: "Copy all screen text" })).toBeVisible();
});

test("home: the Library link shows in the nav on a phone, even with no recent notes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL("/library");
  await page.goto("/");
  expect(await noSideScroll(page)).toBe(true);
});

test("library: the sample is listed after visiting it, search filters it, and the title opens its notes", async ({ page }) => {
  await page.goto("/jobs/sample");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("vidmind-recent") ?? ""), { timeout: 15_000 }).toContain('"sample"');
  await page.goto("/library");
  const row = page.getByRole("listitem").filter({ hasText: "Microservices Architecture" });
  await expect(row.getByRole("link", { name: /Microservices Architecture/ })).toBeVisible();
  await page.getByLabel("Search by title").fill("kafka");
  await expect(page.getByText("No titles match “kafka”.")).toBeVisible();
  await page.getByLabel("Search by title").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await row.getByRole("link", { name: /Microservices Architecture/ }).click();
  await expect(page).toHaveURL("/jobs/sample");
});
