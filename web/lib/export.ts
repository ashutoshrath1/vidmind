// Notes as Markdown, to paste into a doc or keep. Relative imports only (runs under `node --test`).
import type { Diagram, LearnResult } from "./api.ts";

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
