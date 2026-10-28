// Notes as Markdown, to paste into a doc or keep. Relative imports only (runs under `node --test`).
import type { Action, Card, Diagram, LearnResult, Note } from "./api.ts";

// Rounded first, so 59.6 s reads 1:00, not 0:60.
const clock = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/** Timestamps become links to that second when the video is on YouTube, so the proof stays one click away. */
export function toMarkdown(r: LearnResult): string {
  const at = (s: number) => (r.youtube_id ? `[${clock(s)}](https://youtu.be/${r.youtube_id}?t=${Math.floor(s)})` : clock(s));
  const out = [`# ${r.title}`, ""];
  if (r.tldr) out.push(`> ${r.tldr}`, "");
  for (const ch of r.chapters) {
    out.push(`## ${at(ch.start_seconds)} ${ch.title}`, "");
    if (ch.summary) out.push(ch.summary, "");
    for (const n of ch.notes) {
      out.push(`- ${n.text}${n.uncertain ? " _(uncertain)_" : ""}`);
      for (const e of n.evidence)
        out.push(e.kind === "transcript" ? `  - said at ${at(e.start_seconds)}: “${e.quote}”` : `  - on screen at ${at(e.start_seconds)}: ${e.text}`);
    }
    out.push("");
  }
  if (r.quiz.length) {
    out.push("## Quiz", "");
    r.quiz.forEach((q, i) => out.push(`${i + 1}. ${q.question}`, `   - Answer: ${q.answer} (${at(q.evidence_start_seconds)})`));
    out.push("");
  }
  out.push(`_Made with VidMind. Every note above was checked against the video._`, "");
  return out.join("\n");
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** How soon a deadline falls, as said ("Friday", "Nov 3"), for sorting. The meeting's date isn't known, so a weekday
 * counts as this week; deadlines it can't place come after the ones it can, and no deadline comes last. */
export function dueRank(deadline: string | null): number {
  if (!deadline) return 1e6;
  const s = deadline.toLowerCase();
  if (/\b(today|tonight|eod|end of (the )?day)\b/.test(s)) return 0;
  if (/\btomorrow\b/.test(s)) return 1;
  const day = WEEKDAYS.findIndex((d) => s.includes(d));
  if (day >= 0) return (/\bnext\b/.test(s) ? 9 : 2) + day;
  const date = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/);
  if (date) return 100 + MONTHS.indexOf(date[1]) * 31 + Number(date[2]);
  return 1e5;
}

/** Actions soonest first (a stable sort, so equal deadlines keep the order they were said). */
export const byDeadline = <T extends Pick<Action, "deadline">>(items: T[]) => [...items].sort((a, b) => dueRank(a.deadline) - dueRank(b.deadline));

/** Only Slack's own webhook address; the server checks the same before posting. */
export const isSlackWebhook = (url: string) => /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url);

const label = (a: Action) => [a.owner, a.deadline && `due ${a.deadline}`].filter(Boolean).join(", ");

/** Meeting outcomes as a Slack message (mrkdwn): decisions, then actions with owner and deadline. */
export function toSlack(r: LearnResult): string {
  const items = r.actions ?? [];
  const out = [`*${r.title}*`];
  const decisions = items.filter((a) => a.kind === "decision");
  const actions = byDeadline(items.filter((a) => a.kind === "action"));
  if (decisions.length) out.push("", "*Decisions*", ...decisions.map((a) => `• ${a.text}`));
  if (actions.length) out.push("", "*Actions*", ...actions.map((a) => `• ${a.text}${label(a) ? ` (${label(a)})` : ""}`));
  return out.join("\n");
}

const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;

/** Action items as a CSV for Jira's importer (Summary, Assignee, Due date, Description). */
export function toJiraCsv(r: LearnResult): string {
  const rows = byDeadline((r.actions ?? []).filter((a) => a.kind === "action")).map((a) => {
    const proof = a.evidence.map((e) => (e.kind === "transcript" ? `Said at ${clock(e.start_seconds)}: ${e.quote}` : `On screen at ${clock(e.start_seconds)}: ${e.text}`));
    return [a.text, a.owner ?? "", a.deadline ?? "", `From "${r.title}". ${proof.join(" | ")}`].map(cell).join(",");
  });
  return ["Summary,Assignee,Due date,Description", ...rows].join("\n");
}

/** Flashcards for Anki's importer (File → Import): front, back, and the moment in the video that holds the answer. */
export function toAnkiCsv(cards: Card[], youtubeId?: string | null): string {
  const at = (s: number) => (youtubeId ? `https://youtu.be/${youtubeId}?t=${Math.floor(s)}` : clock(s));
  const rows = cards.map((c) => [c.front, c.back, at(c.start_seconds)].map(cell).join(","));
  return ["#separator:Comma", "#html:false", "#columns:Front,Back,Timestamp", ...rows].join("\n");
}

const plain = (t: string) => t.replace(/["|;\n<>{}[\]#]/g, " ").replace(/\s+/g, " ").trim();

/** Mermaid source for a checked diagram. Ids are renumbered and labels stripped of syntax, so model text can't
 * break or inject into the diagram. */
export function toMermaid(d: Diagram): string {
  const id = new Map(d.nodes.map((n, i) => [n.id, `n${i}`]));
  const edges = d.edges.filter((e) => id.has(e.source) && id.has(e.target));
  if (d.kind === "sequence") {
    return ["sequenceDiagram",
      ...d.nodes.map((n) => `  participant ${id.get(n.id)} as ${plain(n.text)}`),
      ...edges.map((e) => `  ${id.get(e.source)}->>${id.get(e.target)}: ${plain(e.label) || " "}`)].join("\n");
  }
  return [d.kind === "architecture" ? "flowchart LR" : "flowchart TD",
    ...d.nodes.map((n) => `  ${id.get(n.id)}["${plain(n.text)}"]`),
    ...edges.map((e) => `  ${id.get(e.source)} -->${plain(e.label) ? `|${plain(e.label)}|` : ""} ${id.get(e.target)}`)].join("\n");
}

const hashtags = (r: LearnResult) =>
  [...new Set(r.chapters.flatMap((c) => c.key_terms))].slice(0, 3)
    .map((t) => "#" + t.replace(/[^\p{L}\p{N}]+(.)?/gu, (_, c: string | undefined) => (c ?? "").toUpperCase()).replace(/^./, (c) => c.toUpperCase()))
    .filter((t) => t.length > 1);

const watchLink = (r: LearnResult) => (r.youtube_id ? `https://youtu.be/${r.youtube_id}` : null);
const firstSentence = (t: string) => t.match(/^.+?[.!?](\s|$)/)?.[0].trim() ?? t;
const at = (n: LearnResult["takeaways"] extends (infer N)[] | undefined ? N : never) =>
  n.evidence.length ? ` (${clock(Math.min(...n.evidence.map((e) => e.start_seconds)))})` : "";

/** A LinkedIn post made only from the checked takeaways: a short hook, each point with the second it came from,
 * the video, and a few tags. Line breaks keep it scannable in the feed. */
export function toLinkedIn(r: LearnResult): string {
  const points = (r.takeaways ?? []).map((t) => `✅ ${t.text}${at(t)}`);
  const link = watchLink(r);
  const tags = hashtags(r).join(" ");
  return [
    `🎥 ${r.title}`,
    ...(r.tldr ? ["", firstSentence(r.tldr)] : []),
    "",
    "What I took away, each point checked against the video:",
    ...points,
    "",
    ...(link ? [`▶ Watch: ${link}`] : []),
    "Notes made with VidMind: every point links to the second it came from.",
    ...(tags ? ["", tags] : []),
  ].join("\n");
}

// X counts a link as 23 characters and an emoji as 2, whatever their real length.
const xLength = (s: string) => [...s.replace(/https?:\/\/\S+/g, "x".repeat(23))].reduce((n, c) => n + (/\p{Extended_Pictographic}/u.test(c) ? 2 : 1), 0);

/** An X post (≤280 as X counts): the title, as many checked takeaways as fit whole (shorter ones fill the space a
 * long one leaves), the video link, and the tags that still fit. */
export function toX(r: LearnResult): string {
  const link = watchLink(r);
  const build = (points: string[], tags: string[]) =>
    [`🎥 ${r.title}`, "", ...points, ...(link ? ["", link] : []), ...(tags.length ? [tags.join(" ")] : [])].join("\n");
  const points: string[] = [];
  for (const t of r.takeaways ?? []) {
    const line = `✅ ${t.text}${at(t)}`;
    if (xLength(build([...points, line], [])) <= 280) points.push(line);
  }
  const tags: string[] = [];
  for (const tag of hashtags(r)) if (xLength(build(points, [...tags, tag])) <= 280) tags.push(tag);
  return build(points, tags);
}

/** The second a step starts in the video: its earliest proof. */
export const shownAt = (n: Note) => (n.evidence.length ? Math.min(...n.evidence.map((e) => e.start_seconds)) : null);

/** A link to second `s`: YouTube's own when the video is there, else the proof view (`proofUrl`, ?view=proof) at it. */
const videoAt = (r: LearnResult, proofUrl: string, s?: number) =>
  r.youtube_id
    ? `https://www.youtube.com/watch?v=${r.youtube_id}${s === undefined ? "" : `&t=${Math.floor(s)}s`}`
    : `${proofUrl}${s === undefined ? "" : `&t=${Math.floor(s)}`}`;

const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();

/** Scenario titles made unique ("Login", "Login (2)"): Playwright refuses two tests with the same name. */
const uniqueTitles = (r: LearnResult) => {
  const seen = new Map<string, number>();
  return (r.scenarios ?? []).map((sc) => {
    const t = oneLine(sc.title) || "Flow";
    const n = (seen.get(t) ?? 0) + 1;
    seen.set(t, n);
    return n > 1 ? `${t} (${n})` : t;
  });
};

/** Every scenario in one Playwright file: each test sits in a describe named after its flow, under comments giving
 * each step and the second the video shows it. Model imports are hoisted and merged so the file has one of each.
 * shortcut: only single-line imports are hoisted; join multi-line ones if the model starts writing them. */
export function toTestSuite(r: LearnResult, proofUrl: string): string {
  const names = new Set(["test", "expect"]);
  const imports = new Set<string>();
  const titles = uniqueTitles(r);
  const blocks = (r.scenarios ?? []).map((sc, i) => {
    const body: string[] = [];
    for (const line of sc.playwright.split("\n")) {
      const pw = line.match(/^\s*import\s*\{([^}]*)\}\s*from\s*["']@playwright\/test["'];?\s*$/);
      if (pw) pw[1].split(",").map((n) => n.trim()).filter(Boolean).forEach((n) => names.add(n));
      else if (/^\s*import\s/.test(line)) imports.add(line.trim());
      else body.push(line);
    }
    const steps = sc.steps.map((s, j) => {
      const at = shownAt(s);
      return `  // ${j + 1}. ${oneLine(s.text)}${at === null ? "" : ` (shown at ${clock(at)})`}`;
    });
    const code = body.join("\n").trim();
    return [`test.describe(${JSON.stringify(titles[i])}, () => {`, ...steps,
      // Kept verbatim, not re-indented: indenting would change multi-line strings inside the test.
      code || "test.fixme(\"write this test from the steps above\", async () => {});",
      "});"].join("\n");
  });
  return [
    `// Playwright tests for "${oneLine(r.title)}", written by VidMind from the demo video.`,
    `// Video: ${videoAt(r, proofUrl)}`,
    "// Each step comment gives the second the video shows it. Set baseURL to your app, then run: npx playwright test",
    `import { ${[...names].join(", ")} } from "@playwright/test";`,
    ...imports,
    "",
    blocks.join("\n\n"),
    "",
  ].join("\n");
}

/** Repro steps as Markdown: each flow's steps numbered, linked to the second the video shows them, with what the
 * screen showed then as the expected result. */
export function toReproSteps(r: LearnResult, proofUrl: string): string {
  const titles = uniqueTitles(r);
  const out = [`# Repro steps: ${oneLine(r.title)}`, "", `Video: ${videoAt(r, proofUrl)}`, ""];
  (r.scenarios ?? []).forEach((sc, i) => {
    out.push(`## ${titles[i]}`, "");
    sc.steps.forEach((s, j) => {
      const at = shownAt(s);
      out.push(`${j + 1}. ${oneLine(s.text)}${at === null ? "" : ` ([${clock(at)}](${videoAt(r, proofUrl, at)}))`}`);
      const screen = s.evidence.filter((e) => e.kind === "frame").at(-1);
      if (screen) out.push(`   - Expected: the screen shows “${oneLine(screen.text)}”`);
    });
    out.push("");
  });
  return out.join("\n");
}
