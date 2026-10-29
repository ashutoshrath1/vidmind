// Run: node --test lib/trace.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { type TraceEvent, buildView, secondsLeft } from "./trace.ts";

const run: TraceEvent[] = [
  { t: 0, kind: "source_ready", origin: "link", title: "Microservices", duration: 316, streaming: true, subtitles: true },
  { t: 0.6, kind: "source", duration: 316, streaming: true, transcript: "subtitles", caption_lines: 49, models: ["groq:a", "groq:b"] },
  { t: 0.6, kind: "plan", sections: [[0, 40], [40, 316]] },
  { t: 0.6, kind: "stage", name: "ocr", state: "start", frames: [{ i: 0, at: 30, url: "frames/0.jpg" }, { i: 1, at: 90, url: "frames/1.jpg" }] },
  { t: 0.7, kind: "frame", i: 0, at: 30, url: "frames/0.jpg", text: "Kubernetes", conf: 98, low_conf: false, seconds: 0.1 },
  { t: 0.8, kind: "frame", i: 1, at: 90, url: "frames/1.jpg", text: "", conf: 0, low_conf: false, seconds: 0.1 },
  { t: 0.8, kind: "stage", name: "ocr", state: "end", seconds: 0.2 },
  { t: 0.8, kind: "transcript", task: "s0", engine: "creator subtitles", seconds: 0, lines: [{ start: 1, end: 4, text: "Hi" }] },
  { t: 0.8, kind: "model", task: "s0", model: "groq:a", state: "start", reason: "first" },
  { t: 0.8, kind: "transcript", task: "s1", engine: "creator subtitles", seconds: 0, lines: [] },
  { t: 0.8, kind: "model", task: "s1", model: "groq:b", state: "start", reason: "first" },
  { t: 2.0, kind: "check", task: "s0", model: "groq:a", round: 1, notes: 3, problems: ["quote not found"], kept: 2 },
  { t: 2.8, kind: "model", task: "s0", model: "groq:a", state: "end", seconds: 2.0 },
  { t: 2.8, kind: "model", task: "s0", model: "groq:a", state: "win" },
  { t: 2.8, kind: "section", task: "s0", ok: true, model: "groq:a", title: "Intro", notes: 3, rejected: 0 },
];

test("folds the trace into frames, sections and the model race", () => {
  const v = buildView(run);
  assert.equal(v.frames[0].read?.text, "Kubernetes");
  assert.equal(v.frames[1].at, 90);
  assert.deepEqual(v.sections[0].attempts.map((a) => [a.model, a.state, a.seconds]), [["groq:a", "won", 2.0]]);
  assert.equal(v.sections[0].checks[0].problems.length, 1);
  assert.equal(v.sections[1].attempts[0].state, "running");
  assert.equal(v.stages.ocr.seconds, 0.2);
});

test("estimates the time left from sections already finished", () => {
  const v = buildView(run);
  // s1 started at 0.8; finished sections took 2.0 s (0.8 → 2.8), so it should end near 2.8.
  assert.equal(Math.round(secondsLeft(v, 2.0)! * 10) / 10, 1);
  assert.equal(secondsLeft(buildView([...run, { t: 3, kind: "done" }]), 3), undefined);
  assert.ok(secondsLeft(buildView(run.slice(0, 2)), 1)! > 0); // no plan yet: a first estimate from the duration
  assert.equal(secondsLeft(buildView([]), 0), undefined); // nothing known yet
});

test("estimates from the video before it starts, close to measured runs", async () => {
  const { estimate } = await import("./estimate.ts");
  // 5-min YouTube lecture with subtitles, scanned on the 360p stream: measured 6.5-7.1 s.
  const yt = estimate({ duration: 316, height: 360, subtitles: true });
  assert.ok(yt.total > 5 && yt.total < 10, String(yt.total));
  // Speech instead of subtitles costs transcription time; 4K costs frame decoding.
  assert.ok(estimate({ duration: 316 }).total > yt.total);
  assert.ok(estimate({ duration: 316, height: 2160 }).frames > 30);
  // The job page uses it until the section plan exists.
  const v = buildView([{ t: 0, kind: "source_ready", origin: "link", duration: 316, subtitles: true }]);
  assert.ok(secondsLeft(v, 0)! > 4);
});

test("exports notes as Markdown with timestamps that link to the moment", async () => {
  const { toMarkdown } = await import("./export.ts");
  const md = toMarkdown({
    title: "Retention", tldr: "Week-1 retention matters.", source: "live", duration_seconds: 60, transcriber: "t", model: "m",
    dropped_notes: 0, youtube_id: "abc",
    chapters: [{ title: "Targets", start_seconds: 20, summary: "", key_terms: [], cover_url: null, notes: [{
      text: "The target is 40%.", uncertain: false, uncertain_reason: null,
      evidence: [{ kind: "frame", start_seconds: 30, text: "Week-1 retention target: 40%", frame_url: "frames/1.jpg" }] }] }],
    quiz: [{ question: "Target?", answer: "40%", evidence_start_seconds: 30 }],
  });
  assert.match(md, /^# Retention/);
  assert.match(md, /## \[0:20\]\(https:\/\/youtu\.be\/abc\?t=20\) Targets/);
  assert.match(md, /on screen at \[0:30\]\(https:\/\/youtu\.be\/abc\?t=30\): Week-1 retention target: 40%/);
  assert.match(md, /1\. Target\?\n {3}- Answer: 40%/);
});

test("diagrams become Mermaid with safe ids and labels", async () => {
  const { toMermaid } = await import("./export.ts");
  const ev = [{ kind: "transcript" as const, start_seconds: 1, quote: "q" }];
  const node = (id: string, text: string) => ({ id, text, evidence: ev, uncertain: false, uncertain_reason: null });
  const d = { kind: "sequence" as const, title: "Login", nodes: [node("client app", 'Client "web"'), node("api", "API; gateway")],
    edges: [{ source: "client app", target: "api", label: "POST /login" }, { source: "api", target: "gone", label: "" }] };
  assert.equal(toMermaid(d), "sequenceDiagram\n  participant n0 as Client web\n  participant n1 as API gateway\n  n0->>n1: POST /login");
  assert.equal(toMermaid({ ...d, kind: "architecture" }), 'flowchart LR\n  n0["Client web"]\n  n1["API gateway"]\n  n0 -->|POST /login| n1');

});

test("lists every model and what it did, from the trace alone", async () => {
  const { modelsUsed } = await import("./trace.ts");
  const used = modelsUsed([
    { t: 0, kind: "plan", sections: [[0, 40], [40, 140]] },
    { t: 1, kind: "transcript", task: "s0", engine: "asr-x", seconds: 3, lines: [{ start: 0, end: 1, text: "a" }] },
    { t: 2, kind: "transcript", task: "s1", engine: "asr-x", seconds: 9, lines: [{ start: 40, end: 41, text: "b" }] },
    { t: 2, kind: "stage", name: "ocr", state: "end", seconds: 1, model: "ocr-y" },
    { t: 3, kind: "watch", task: "s0", model: "p:llm-a", seconds: 40 },
    { t: 4, kind: "model", task: "s0", model: "p:llm-a", state: "end", seconds: 3 },
    { t: 4, kind: "model", task: "s0", model: "p:llm-a", state: "win" },
    { t: 4, kind: "model", task: "s0", model: "q:llm-b", state: "fail", seconds: 1 },
    { t: 5, kind: "model", task: "visual", model: "p:llm-a", state: "win" },
    { t: 6, kind: "stage", name: "crop", state: "end", cropped: 1, of: 6, model: "seg-z" },
  ]);
  assert.deepEqual(used.map((u) => [u.model, u.did]), [
    ["asr-x", ["transcribed 2:20 of speech"]],
    ["ocr-y", ["read the text on 0 keyframes"]],
    ["p:llm-a", ["watched 0:40 of video", "wrote 1 section", "wrote the takeaways and diagram"]],
    ["q:llm-b", ["1 call, none chosen"]],
    ["seg-z", ["found the screen in 6 keyframes, cropped 1"]],
  ]);
});

test("turns the trace into lanes of bars: stages, transcription parts, and model attempts with the winner", async () => {
  const { lanesOf } = await import("./trace.ts");
  const lanes = lanesOf([
    { t: 0.2, kind: "stage", name: "scenes", state: "start", detail: "Scanning" },
    { t: 1.5, kind: "stage", name: "scenes", state: "end", seconds: 1.3 },
    { t: 3, kind: "transcript", task: "s0", engine: "asr-x", seconds: 2, lines: [] },
    { t: 3, kind: "model", task: "s0", model: "a", state: "start", reason: "first" },
    { t: 4, kind: "model", task: "s0", model: "b", state: "start", reason: "hedge" },
    { t: 5, kind: "model", task: "s0", model: "a", state: "end", seconds: 2 },
    { t: 5, kind: "model", task: "s0", model: "a", state: "win" },
    { t: 5.5, kind: "stage", name: "card", state: "start", model: "img" },
  ], 7);
  assert.deepEqual(lanes.map((l) => [l.name, l.bars.map((b) => [b.start, b.end, b.model, b.state])]), [
    ["Transcript", [[1, 3, "asr-x", "done"]]],
    ["Scene changes", [[0.2, 1.5, undefined, "done"]]],
    ["Notes", [[3, 5, "a", "won"], [4, 7, "b", "running"]]], // b is still going at now = 7
    ["Summary card", [[5.5, 7, "img", "running"]]],
  ]);
});

test("checked notes show under their section as they arrive, before the section is done", () => {
  const note = { text: "Welcome.", uncertain: false, uncertain_reason: null, evidence: [{ kind: "transcript" as const, start_seconds: 1, quote: "welcome" }] };
  const v = buildView([
    { t: 0, kind: "plan", sections: [[0, 20], [20, 60]] },
    { t: 2.1, kind: "note", task: "s1", model: "muse:muse-spark-1.2", note },
  ]);
  assert.deepEqual(v.sections.map((s) => s.notes.length), [0, 1]);
  assert.equal(v.sections[1].done, undefined);
});
