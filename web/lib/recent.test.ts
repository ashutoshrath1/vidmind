import assert from "node:assert/strict";
import { test } from "node:test";
import { fresh, kept, remember } from "./recent.ts";

test("recent notes: newest first, no duplicates, capped, and gone after the server's 24 hours", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const a = { id: "a", title: "Kafka", at: now - 1000 };
  const b = { id: "b", title: "DevOps", at: now - 2000 };
  assert.deepEqual(remember([a, b], { ...b, at: now }).map((r) => r.id), ["b", "a"]);
  assert.equal(remember(Array.from({ length: 60 }, (_, i) => ({ id: `${i}`, title: "x", at: now })), a).length, 50);
  assert.deepEqual(fresh([a, { id: "old", title: "Old", at: now - 25 * 3600 * 1000 }, { id: "", title: "", at: now }], now), [a]);
});

test("a kept job outlives the 24 hours until its keep ends; the sample never goes", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const old = { id: "old", title: "Old", at: now - 3 * 24 * 3600 * 1000 };
  const sample = { id: "sample", title: "Sample", at: now - 30 * 24 * 3600 * 1000 };
  assert.deepEqual(fresh([old, sample], now), [sample]);
  const list = kept([old, sample], "old", now + 1000);
  assert.deepEqual(fresh(list, now).map((r) => r.id), ["old", "sample"]);
  assert.deepEqual(fresh(list, now + 2000).map((r) => r.id), ["sample"]);
  assert.deepEqual(fresh(kept(list, "old", null), now).map((r) => r.id), ["sample"]); // unkept: back to 24 hours
});
