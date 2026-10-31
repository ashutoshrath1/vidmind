import { modelName } from "../lib/api.ts";
import type { TraceEvent, View } from "../lib/trace.ts";

export type Row = { id: string; label: string; start: number; end: number; tool: string; model: boolean; count?: string };

const names = (ids: string[]) => [...new Set(ids.flatMap((id) => id.split("+").map((x) => x.trim())))].map(modelName).join(" + ");

/** Every real step of the run as one labeled bar: when it ran, how long, which model or tool did it. AI models are
 * blue, open-source tools grey. Built only from the trace; a step that did not run has no bar. */
export function rowsOf(view: View): Row[] {
  const ev = view.events;
  const stage = (name: string) => ev.filter((e): e is Extract<TraceEvent, { kind: "stage" }> => e.kind === "stage" && e.name === name);
  const span = (name: string) => {
    const all = stage(name);
    const start = all.find((e) => e.state === "start")?.t;
    const ends = all.filter((e) => e.state === "end");
    if (start === undefined || !ends.length) return undefined;
    return { start, end: Math.max(...ends.map((e) => e.t)), model: ends.find((e) => e.model)?.model ?? all.find((e) => e.model)?.model };
  };
  const rows: Row[] = [];
  const add = (id: string, label: string, s: { start: number; end: number } | undefined, tool: string, model: boolean, count?: string) => {
    if (s) rows.push({ id, label, start: s.start, end: Math.max(s.end, s.start + 0.05), tool, model, count });
  };
  const captions = view.source?.transcript === "subtitles";
  add("fetch", "Getting the video", span("fetch"), "yt-dlp and ffmpeg", false);
  const engine = ev.find((e): e is Extract<TraceEvent, { kind: "transcript" }> => e.kind === "transcript" && !/subtitle/.test(e.engine))?.engine;
  const hear = span("transcribe") ?? span("audio");
  if (captions) add("hear", "Reading the captions", hear ?? span("fetch"), "the video's own captions", false); // fetched with the stream
  else add("hear", "Turning speech into text", hear, (hear?.model ?? engine) ? names([(hear?.model ?? engine)!]) : "speech recognition", true);
  add("scenes", "Finding slide changes", span("scenes"), "ffmpeg", false);
  add("frames", "Capturing keyframes", span("frames"), "ffmpeg", false);
  const secs = ev.filter((e): e is Extract<TraceEvent, { kind: "section" }> => e.kind === "section" && e.ok);
  const starts = ev.filter((e) => e.kind === "model" && e.state === "start" && /^s\d+$/.test(e.task)).map((e) => e.t);
  if (secs.length && starts.length)
    add("notes", "Writing the notes", { start: Math.min(...starts), end: Math.max(...secs.map((e) => e.t)) }, names(secs.map((e) => e.model)), true,
      `${secs.length} sections at once, each checked`);
  const overview = ev.find((e) => e.kind === "overview");
  const ovStart = ev.find((e) => e.kind === "model" && e.task === "overview" && e.state === "start");
  if (overview && ovStart) add("overview", "Title and summary", { start: ovStart.t, end: overview.t }, ovStart.kind === "model" ? names([ovStart.model]) : "AI model", true);
  const visual = ev.find((e) => e.kind === "visual");
  const visStart = ev.find((e) => e.kind === "model" && e.task === "visual" && e.state === "start");
  if (visual && visStart) add("visual", "Takeaways and diagram", { start: visStart.t, end: visual.t }, visStart.kind === "model" ? names([visStart.model]) : "AI model", true);
  const screen = span("screen");
  add("screen", "Notes from the slides", screen, screen?.model ? names([screen.model]) : "AI model", true);
  add("article", "Writing the article", span("article"), span("article")?.model ? names([span("article")!.model!]) : "AI model", true);
  add("slides", "Explaining each slide", span("slides"), span("slides")?.model ? names([span("slides")!.model!]) : "AI model", true);
  add("ocr", "Reading text on screen", span("ocr"), span("ocr")?.model ? names([span("ocr")!.model!]) : "AI model", true);
  add("crop", "Cutting out diagrams", span("crop"), span("crop")?.model ? names([span("crop")!.model!]) : "vision model", true);
  add("images", "Drawing the illustrations", span("images"), span("images")?.model ? names([span("images")!.model!]) : "image model", true);
  add("card", "Drawing the summary card", span("card"), span("card")?.model ? names([span("card")!.model!]) : "image model", true);
  return rows.sort((a, b) => a.start - b.start || a.end - b.end);
}
