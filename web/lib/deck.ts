// Spaced repetition for the study deck (SM-2 lite), kept per job in this browser. Relative imports only (node --test).
import type { Card } from "./api.ts";

export type Review = { due: number; interval: number; ease: number; reps: number }; // due: ms since epoch; interval: days
export type Progress = Record<string, Review>;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const cardKey = (c: Card) => `${c.start_seconds}|${c.front}`;

/** "Again" brings the card back in a minute and lowers its ease; "Got it" waits 1 day, then 3, then grows by ease. */
export function review(prev: Review | undefined, gotIt: boolean, now: number): Review {
  const r = prev ?? { due: now, interval: 0, ease: 2.5, reps: 0 };
  if (!gotIt) return { due: now + MIN, interval: 0, ease: Math.max(1.3, r.ease - 0.2), reps: 0 };
  const interval = r.reps === 0 ? 1 : r.reps === 1 ? 3 : Math.round(r.interval * r.ease);
  return { due: now + interval * DAY, interval, ease: r.ease, reps: r.reps + 1 };
}

/** Cards due now (new ones first, then the longest waiting), how many are learned, and when the next one is due. */
export function schedule(cards: Card[], progress: Progress, now: number) {
  const dueAt = (c: Card) => progress[cardKey(c)]?.due ?? 0;
  const due = cards.filter((c) => dueAt(c) <= now).sort((a, b) => dueAt(a) - dueAt(b));
  const learned = cards.filter((c) => (progress[cardKey(c)]?.reps ?? 0) > 0).length;
  const later = cards.map(dueAt).filter((t) => t > now);
  return { due, learned, next: later.length ? Math.min(...later) : null };
}

/** "in 5 minutes", "in 3 hours", "tomorrow". */
export function dueIn(ms: number): string {
  const f = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const min = Math.max(1, Math.ceil(ms / MIN));
  if (min < 60) return f.format(min, "minute");
  if (min < 24 * 60) return f.format(Math.round(min / 60), "hour");
  return f.format(Math.round(min / (24 * 60)), "day");
}

const key = (jobId: string) => `vidmind-deck-${jobId}`;

export function loadProgress(jobId: string): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(key(jobId)) ?? "{}");
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

export function saveProgress(jobId: string, progress: Progress) {
  try {
    localStorage.setItem(key(jobId), JSON.stringify(progress));
  } catch {} // private mode or storage full: progress is a convenience, never worth an error
}
