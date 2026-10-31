import assert from "node:assert/strict";
import { test } from "node:test";
import { type TraceEvent, buildView } from "../lib/trace.ts";
import { rowsOf } from "./MadeRows.ts";

test("one labeled row per step that ran, AI models apart from open-source tools, in time order", () => {
  const ev: TraceEvent[] = [
    { t: 0, kind: "source", duration: 60, streaming: true, transcript: "subtitles", caption_lines: 9, models: [] } as TraceEvent,
    { t: 0, kind: "stage", name: "fetch", state: "start" },
    { t: 0.5, kind: "stage", name: "fetch", state: "end", seconds: 0.5 },
    { t: 0.5, kind: "plan", sections: [[0, 30], [30, 60]] },
    { t: 0.6, kind: "model", task: "s0", model: "openai:gpt-5", state: "start", reason: "first" },
    { t: 0.6, kind: "model", task: "s1", model: "openai:gpt-5", state: "start", reason: "first" },
    { t: 3.5, kind: "section", task: "s0", ok: true, model: "openai:gpt-5", title: "a", notes: 3, rejected: 0 },
    { t: 4.2, kind: "section", task: "s1", ok: true, model: "muse:muse-spark-1.3", title: "b", notes: 2, rejected: 0 },
    { t: 5, kind: "stage", name: "images", state: "start" },
    { t: 20, kind: "stage", name: "images", state: "end", seconds: 15, model: "muse:muse-image-1.0" },
    { t: 21, kind: "stage", name: "crop", state: "start" },
    { t: 22, kind: "stage", name: "crop", state: "end", seconds: 1 },
  ];
  const rows = rowsOf(buildView(ev));
  assert.deepEqual(rows.map((r) => r.id), ["fetch", "hear", "notes", "images", "crop"]);
  assert.equal(rows.find((r) => r.id === "hear")?.tool, "the video's own captions"); // captions: no model
  const notes = rows.find((r) => r.id === "notes")!;
  assert.deepEqual([notes.start, notes.end, notes.model, notes.tool], [0.6, 4.2, true, "GPT-5 + Muse Spark 1.3"]);
  assert.equal(rows.find((r) => r.id === "fetch")?.model, false); // open source
  assert.equal(rows.find((r) => r.id === "images")?.tool, "Muse Image 1.0");
  assert.equal(rows.find((r) => r.id === "crop")?.tool, "vision model"); // no model in the trace: generic role name
});

test("speech recognition is named from the trace, whatever the provider", () => {
  const ev = [
    { t: 0, kind: "stage", name: "transcribe", state: "start" },
    { t: 2, kind: "stage", name: "transcribe", state: "end", seconds: 2 },
    { t: 2, kind: "transcript", task: "s0", engine: "local:whisper-base", lines: [{ t: 0, text: "x" }], seconds: 2 },
  ] as unknown as TraceEvent[];
  assert.equal(rowsOf(buildView(ev)).find((r) => r.id === "hear")?.tool, "Whisper Base");
});
