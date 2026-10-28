import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import type { Action, LearnResult, Note } from "./api.ts";
import { byDeadline, dueRank, isSlackWebhook, toReproSteps, toTestSuite } from "./export.ts";

const action = (text: string, deadline: string | null): Action =>
  ({ text, deadline, owner: null, kind: "action", evidence: [], uncertain: false, uncertain_reason: null });

test("actions sort soonest first: today, weekdays this week, next week, dates, then unplaced, then none", () => {
  const said = ["no deadline", "Nov 3", "next Monday", "end of quarter", "Friday", "tomorrow", "Oct 30", "Tuesday"];
  const sorted = byDeadline(said.map((d) => action(d, d === "no deadline" ? null : d)));
  assert.deepEqual(sorted.map((a) => a.text), ["tomorrow", "Tuesday", "Friday", "next Monday", "Oct 30", "Nov 3", "end of quarter", "no deadline"]);
});

test("equal deadlines keep the order they were said", () => {
  assert.deepEqual(byDeadline([action("a", null), action("b", "Friday"), action("c", null)]).map((a) => a.text), ["b", "a", "c"]);
  assert.equal(dueRank("EOD"), 0);
});

test("only Slack's own incoming webhooks are accepted", () => {
  assert.ok(isSlackWebhook("https://hooks.slack.com/services/T000/B000/abc123"));
  for (const bad of ["http://hooks.slack.com/services/T/B/x", "https://hooks.slack.com.evil.example/services/T/B/x",
    "https://hooks.slack.com/services/T/B/x/../y", "https://hooks.slack.com/triggers/T/B/x", " https://hooks.slack.com/services/T/B/x"])
    assert.ok(!isSlackWebhook(bad), bad);
});

const step = (text: string, ...at: number[]): Note => ({ text, uncertain: false, uncertain_reason: null,
  evidence: at.map((t, i) => (i ? { kind: "frame", start_seconds: t, text: `screen at ${t}`, frame_url: null } : { kind: "transcript", start_seconds: t, quote: "said" })) });
const demo = (youtube_id: string | null): LearnResult => ({
  title: "Taskly demo", chapters: [], quiz: [], source: "live", tldr: "", duration_seconds: 60, transcriber: "", model: "", dropped_notes: 0,
  youtube_id, mode: "test",
  scenarios: [
    { title: 'Add "milk" `fast`', steps: [step("Type `Buy milk` and press \"Add\"\nthen check", 41.6, 42.2, 45)],
      playwright: "import { test, expect } from '@playwright/test';\nimport { type Page } from '@playwright/test';\n\ntest('adds', async ({ page }) => {\n  await page.fill('#t', `a\nb`);\n});" },
    { title: "Add \"milk\" `fast`", steps: [step("Clear", 59.6)], playwright: "" },
  ],
});
const PROOF = "http://localhost:3000/jobs/abc?view=proof";

test("test suite: one valid file, names escaped and unique, steps with the second they were shown", () => {
  const suite = toTestSuite(demo(null), PROOF);
  const parsed = ts.transpileModule(suite, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
  assert.deepEqual(parsed.diagnostics?.map((d) => d.messageText), []);
  assert.equal(suite.match(/from "@playwright\/test"/g)?.length, 1);
  assert.match(suite, /^import \{ test, expect, type Page \} from "@playwright\/test";$/m);
  assert.match(suite, /^\/\/ Video: http:\/\/localhost:3000\/jobs\/abc\?view=proof$/m);
  assert.ok(suite.includes('test.describe("Add \\"milk\\" `fast`", () => {'));
  assert.ok(suite.includes('test.describe("Add \\"milk\\" `fast` (2)", () => {'));
  assert.ok(suite.includes('  // 1. Type `Buy milk` and press "Add" then check (shown at 0:42)'));
  assert.ok(suite.includes("(shown at 1:00)"));
  assert.ok(suite.includes("`a\nb`")); // model code kept verbatim
  assert.equal(toTestSuite(demo(null), PROOF), suite); // stable
  assert.match(toTestSuite(demo("abc123"), PROOF), /^\/\/ Video: https:\/\/www\.youtube\.com\/watch\?v=abc123$/m);
});

test("repro steps: numbered, linked to the second, with what the screen showed", () => {
  const md = toReproSteps(demo("abc123"), PROOF);
  assert.ok(md.includes("1. Type `Buy milk` and press \"Add\" then check ([0:42](https://www.youtube.com/watch?v=abc123&t=41s))"));
  assert.ok(md.includes("   - Expected: the screen shows “screen at 45”"));
  assert.ok(md.includes("## Add \"milk\" `fast` (2)"));
  assert.ok(toReproSteps(demo(null), PROOF).includes("1. Clear ([1:00](http://localhost:3000/jobs/abc?view=proof&t=59))"));
});
