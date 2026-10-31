import assert from "node:assert/strict";
import { test } from "node:test";
import type { TraceEvent } from "../lib/trace.ts";
import { buildView } from "../lib/trace.ts";
import { explain, isFiller, isQuiet, slidesOf } from "./OnScreenSlides.ts";

const frame = (i: number, at: number, text: string): TraceEvent =>
  ({ t: 1, kind: "frame", i, at, url: `frames/${i}.jpg`, text, conf: 1, low_conf: false, seconds: 0 });
const note = (text: string, kind: "frame" | "transcript", at: number): TraceEvent => ({
  t: 2, kind: "note", task: "s0", model: "m",
  note: { text, uncertain: false, uncertain_reason: null,
    evidence: [kind === "frame" ? { kind, start_seconds: at, text: "", frame_url: null } : { kind, start_seconds: at, quote: "" }] },
});

test("same words in another order fold into one slide; frame notes win over spoken ones; speech splits by slide", () => {
  const view = buildView([
    { t: 0, kind: "plan", sections: [[0, 100]] },
    { t: 0, kind: "transcript", task: "s0", engine: "e", seconds: 1, lines: [{ start: 5, end: 9, text: "hello" }, { start: 50, end: 55, text: "next" }] },
    frame(1, 30, "B A"), frame(0, 0, "A B"), frame(2, 40, "C"),
    note("cites the first", "frame", 31), note("said early", "transcript", 5), note("said late", "transcript", 50),
  ]);
  const s = slidesOf(view);
  assert.deepEqual(s.map((x) => [x.start, x.end, x.frames.length]), [[0, 40, 2], [40, Infinity, 1]]);
  assert.deepEqual(s[0].notes.map((n) => n.text), ["cites the first"]);
  assert.deepEqual(s[1].notes.map((n) => n.text), ["said late"]);
  assert.deepEqual(s.map((x) => x.said.map((l) => l.text)), [["hello"], ["next"]]);
});

test("explanations match slides within 2 s; quiet screens and filler speech are spotted", () => {
  const view = buildView([frame(0, 0, "Logo"), frame(1, 30, "one two three four five six seven")]);
  const s = explain(slidesOf(view), [{ t: 31.5, title: "T", explanation: "E" }, { t: 10, title: "far", explanation: "x" }]);
  assert.equal(s[0].explained, undefined);
  assert.equal(s[1].explained?.title, "T");
  assert.equal(isQuiet(s[0]), true);
  assert.equal(isQuiet({ ...s[1], explained: undefined }), true); // explanations exist, this screen has none
  assert.equal(isQuiet({ ...s[1], explained: undefined }, false), false); // old result: real text stays
  assert.equal(isFiller({ start: 0, end: 1, text: "Yeah." }), true);
  assert.equal(isFiller({ start: 0, end: 1, text: "Kubernetes runs pods" }), false);
});
