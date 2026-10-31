// Notes as Markdown, to paste into a doc or keep. Relative imports only (runs under `node --test`).
import { type Diagram, type LearnResult, formatTime as clock } from "./api.ts";

/** Timestamps become links to that second when the video is on YouTube, so the proof stays one click away. */
export function toMarkdown(r: LearnResult): string {
  // A clean article: one watch link per section instead of a time after every sentence (the page keeps those).
  // Rounded like the label beside it, so "Watch from 0:21" opens at 21 s.
  const link = (s: number) => (r.youtube_id ? `https://youtu.be/${r.youtube_id}${Math.round(s) ? `?t=${Math.round(s)}` : ""}` : null);
  const out = [`# ${r.title}`, ""];
  const source = link(0);
  out.push(source ? `*Source: [the video on YouTube](${source}), ${clock(r.duration_seconds)} long.*` : `*From a ${clock(r.duration_seconds)} video.*`, "");
  if (r.tldr) out.push(r.tldr, "");
  if (r.takeaways?.length) out.push("## Key takeaways", "", ...r.takeaways.map((t) => `- ${t.text}`), "");
  if (r.diagram && r.diagram.nodes.length > 1) out.push(`## ${r.diagram.title}`, "", "```mermaid", toMermaid(r.diagram), "```", "");
  for (const ch of r.chapters) {
    out.push(`## ${ch.title}`, "");
    const watch = link(ch.start_seconds);
    if (watch) out.push(`[Watch from ${clock(ch.start_seconds)}](${watch})`, "");
    const lead = ch.hook || ch.summary;
    if (lead) out.push(`**${lead}**`, "");
    const article = ch.article?.filter((p) => p.text) ?? [];
    if (article.length) out.push(...article.flatMap((p) => [p.text, ""]));
    else out.push(...ch.notes.map((n) => `- ${n.text}`), "");
  }
  if (r.quiz.length) {
    out.push("## Check yourself", "");
    r.quiz.forEach((q, i) => out.push(`${i + 1}. ${q.question}`, `   *${q.answer}*`));
    out.push("");
  }
  out.push("---", "", "*Written by VidMind from the video. Every point was checked against what was said or shown.*", "");
  return out.join("\n");
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
    ...edges.map((e) => `  ${id.get(e.source)} -->${plain(e.label) ? `|"${plain(e.label)}"|` : ""} ${id.get(e.target)}`)].join("\n");
}
