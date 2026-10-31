// The On screen walkthrough's data: keyframes folded into slides, each with the notes and speech of its time on screen.
// Relative .ts imports only: `node --test components/OnScreenSlides.test.ts` runs this file without the Next toolchain.
import type { Note, Slide as Explained } from "../lib/api.ts";
import type { FrameView, Line, View } from "../lib/trace.ts";

export type Slide = { frames: FrameView[]; start: number; end: number; text: string; notes: Note[]; said: Line[]; explained?: Explained };

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

/** Attach each model explanation (result.slides) to the slide with a frame within 2 s of its time. */
export const explain = (slides: Slide[], explained: Explained[] = []): Slide[] =>
  slides.map((s) => ({ ...s, explained: explained.find((x) => x.explanation?.trim() && s.frames.some((f) => Math.abs(f.at - x.t) <= 2)) }));

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
/** Speech filler worth hiding: "Yeah", "Okay.", "Thank you". */
export const isFiller = (l: Line) => words(l.text) <= 2;
/** Nothing to say about it: no explanation and no note cites it (a logo, a title card, or a screen the explainer
 * skipped as not meaningful). Old results without explanations keep any screen with real text on it. */
export const isQuiet = (s: Slide, explained = true) =>
  !s.explained && !s.notes.length && (explained || words(s.text) < 6);
