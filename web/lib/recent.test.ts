import assert from "node:assert/strict";
import { test } from "node:test";
import { fresh, remember } from "./recent.ts";

test("recent notes: newest first, no duplicates, capped, and gone after the server's 24 hours", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const a = { id: "a", title: "Kafka", at: now - 1000 };
  const b = { id: "b", title: "DevOps", at: now - 2000 };
  assert.deepEqual(remember([a, b], { ...b, at: now }).map((r) => r.id), ["b", "a"]);
  assert.equal(remember(Array.from({ length: 60 }, (_, i) => ({ id: `${i}`, title: "x", at: now })), a).length, 50);
  assert.deepEqual(fresh([a, { id: "old", title: "Old", at: now - 25 * 3600 * 1000 }, { id: "", title: "", at: now }], now), [a]);
});
