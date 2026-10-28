// Notes as Markdown, to paste into a doc or keep. Relative imports only (runs under `node --test`).
import type { Card, Diagram, LearnResult } from "./api.ts";

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

const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;

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
