// The On screen walkthrough's data: keyframes folded into slides, each with the notes and speech of its time on screen.
// Relative .ts imports only: `node --test components/OnScreenSlides.test.ts` runs this file without the Next toolchain.
import type { Note } from "../lib/api.ts";
import type { FrameView, Line, View } from "../lib/trace.ts";

export type Slide = { frames: FrameView[]; start: number; end: number; text: string; notes: Note[]; said: Line[] };

// OCR reads the same slide's words in a different order frame to frame, so compare the sorted words.
const key = (text = "") => text.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");

/** Keyframes in time order, consecutive ones with the same words folded into one slide. A slide is up from its first
 * frame until the next slide (the last one until the video ends); notes citing its frames (±2 s) come first, else
 * notes whose spoken evidence falls in that window. */
export function slidesOf(view: View): Slide[] {
  const frames = view.frames.filter(Boolean).map((f) => (f.read ? { ...f, at: f.read.at } : f)).sort((a, b) => a.at - b.at);
  const groups: FrameView[][] = [];
  for (const f of frames) {
    const last = groups.at(-1);
    if (last && f.read && last[0].read && key(f.read.text) === key(last[0].read.text)) last.push(f);
    else groups.push([f]);
  }
  const notes = view.sections.flatMap((s) => s.notes);
  const lines = view.sections.flatMap((s) => s.lines ?? []);
  const close = view.source?.duration ?? view.ready?.duration ?? Infinity;
  return groups.map((g, i) => {
    const start = g[0].at;
    const end = groups[i + 1]?.[0].at ?? close;
    const cites = notes.filter((n) => n.evidence.some((e) => e.kind === "frame" && g.some((f) => Math.abs(f.at - e.start_seconds) <= 2)));
    const during = notes.filter((n) => n.evidence.some((e) => e.kind === "transcript" && e.start_seconds >= start && e.start_seconds < end));
    return {
      frames: g, start, end, text: g[0].read?.text.trim() ?? "",
      notes: cites.length ? cites : during,
      said: lines.filter((l) => l.start >= start && l.start < end),
    };
  });
}

/** Everything a slide holds as one searchable string: screen text, speech, notes. */
export const slideText = (s: Slide) => [s.text, ...s.said.map((l) => l.text), ...s.notes.map((n) => n.text)].join("\n");
