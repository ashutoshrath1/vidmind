import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "./api.ts";
import { cardKey, dueIn, review, schedule } from "./deck.ts";
import { toAnkiCsv } from "./export.ts";

const DAY = 24 * 3600 * 1000;
const card = (front: string, start_seconds = 12): Card => ({ front, back: "b", kind: "recall", start_seconds, source_note: "n" });

test("SM-2 lite: Got it waits 1, 3, then ease x days; Again brings it back in a minute and lowers the ease", () => {
  const now = Date.UTC(2026, 9, 28);
  let r = review(undefined, true, now);
  assert.deepEqual([r.interval, r.due - now], [1, DAY]);
  r = review(r, true, now);
  assert.equal(r.interval, 3);
  r = review(r, true, now);
  assert.equal(r.interval, 8); // round(3 x 2.5)
  r = review(r, false, now);
  assert.deepEqual([r.reps, r.interval, r.due - now, r.ease], [0, 0, 60_000, 2.3]);
  assert.equal(review({ ...r, ease: 1.35 }, false, now).ease, 1.3); // floor
});

test("schedule: new and overdue cards are due, learned counts passed cards, next is the soonest later one", () => {
  const now = Date.UTC(2026, 9, 28);
  const [a, b, c] = [card("a"), card("b"), card("c")];
  const progress = { [cardKey(a)]: review(undefined, true, now), [cardKey(b)]: review(undefined, false, now - 120_000) };
  const s = schedule([a, b, c], progress, now);
  assert.deepEqual(s.due.map((x) => x.front), ["c", "b"]); // new first, then the one failed earlier
  assert.equal(s.learned, 1);
  assert.equal(s.next, now + DAY);
  assert.deepEqual(schedule([a], progress, now), { due: [], learned: 1, next: now + DAY });
  assert.equal(dueIn(DAY), "tomorrow");
  assert.equal(dueIn(30_000), "in 1 minute");
});

test("Anki CSV: header lines, quoted cells, and a YouTube link to the second (or the time)", () => {
  const cards = [card('Say "hi", then?', 75.6)];
  assert.equal(toAnkiCsv(cards, "abc"),
    '#separator:Comma\n#html:false\n#columns:Front,Back,Timestamp\n"Say ""hi"", then?","b","https://youtu.be/abc?t=75"');
  assert.ok(toAnkiCsv(cards).endsWith(',"1:16"'));
});
