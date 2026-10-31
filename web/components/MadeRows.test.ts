import assert from "node:assert/strict";
import { test } from "node:test";
import { type TraceEvent, buildView } from "../lib/trace.ts";
import { rowsOf } from "./MadeRows.ts";

test("one labeled row per step that ran, meta models apart from open-source tools, in time order", () => {
  const ev: TraceEvent[] = [
    { t: 0, kind: "source", duration: 60, streaming: true, transcript: "subtitles", caption_lines: 9, models: [] } as TraceEvent,
    { t: 0, kind: "stage", name: "fetch", state: "start" },
    { t: 0.5, kind: "stage", name: "fetch", state: "end", seconds: 0.5 },
    { t: 0.5, kind: "plan", sections: [[0, 30], [30, 60]] },
    { t: 0.6, kind: "model", task: "s0", model: "muse:muse-spark-1.2", state: "start", reason: "first" },
    { t: 0.6, kind: "model", task: "s1", model: "muse:muse-spark-1.2", state: "start", reason: "first" },
    { t: 3.5, kind: "section", task: "s0", ok: true, model: "muse:muse-spark-1.2", title: "a", notes: 3, rejected: 0 },
    { t: 4.2, kind: "section", task: "s1", ok: true, model: "muse:muse-spark-1.3", title: "b", notes: 2, rejected: 0 },
    { t: 5, kind: "stage", name: "images", state: "start" },
    { t: 20, kind: "stage", name: "images", state: "end", seconds: 15 },
  ];
  const rows = rowsOf(buildView(ev));
  assert.deepEqual(rows.map((r) => r.id), ["fetch", "hear", "notes", "images"]);
  assert.equal(rows.find((r) => r.id === "hear")?.tool, "the video's own captions"); // captions: no model
  const notes = rows.find((r) => r.id === "notes")!;
  assert.deepEqual([notes.start, notes.end, notes.meta, notes.tool], [0.6, 4.2, true, "Muse Spark 1.2 + Muse Spark 1.3"]);
  assert.equal(rows.find((r) => r.id === "fetch")?.meta, false); // open source
  assert.equal(rows.find((r) => r.id === "images")?.tool, "Muse Image");
});
