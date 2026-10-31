"use client";

import { type ReactNode, createContext, useContext } from "react";
import type { Seek } from "@/components/ui";
import { type Evidence, type Note, formatTime } from "@/lib/api";

const tip =
  "pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-max max-w-[min(18rem,80vw)] -translate-x-1/2 rounded-xl bg-ink whitespace-normal px-3 py-2 text-left font-sans text-xs leading-snug font-normal text-lightbox shadow-lg group-hover:block group-focus-visible:block";

/** Where this job's keyframes are served, so a citation can show the frame it was checked against. */
export const FrameBase = createContext("");

/** A quiet citation after a sentence: the time, "on screen" for a frame. The quoted words show on hover and focus. */
export function Cite({ evidence: e, seek }: { evidence: Evidence; seek: Seek }) {
  const said = e.kind === "frame" ? e.text : `“${e.quote}”`;
  const label = `${e.kind === "frame" ? "On screen" : "Said"} at ${formatTime(e.start_seconds)}`;
  const base = useContext(FrameBase);
  const frame = e.kind === "frame" && e.frame_url && base ? `${base}/${e.frame_url}` : null;
  return (
    <button
      onClick={() => seek(e.start_seconds)}
      aria-label={`${label}, checked: ${said}. Play from here`}
      data-seek={e.start_seconds}
      className="cite group relative ml-1 rounded-sm align-super font-sans text-[0.6875rem] leading-none font-medium whitespace-nowrap text-scan-ink hover:underline"
    >
      {/* Every citation on the page passed the check; the tick says so without a word. */}
      <span aria-hidden className="mr-0.5 text-proof">✓</span>
      <span className="tabular">{formatTime(e.start_seconds)}</span>
      {e.kind === "frame" && <span className="ml-0.5 text-graphite"> on screen</span>}
      <span role="tooltip" className={tip}>
        {/* The exact keyframe the note was checked against; it loads only when the tip opens (hidden until then). */}
        {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
        {frame && <img src={frame} alt="" width={288} height={162} loading="lazy" className="mb-2 block aspect-video w-72 max-w-full rounded-lg bg-black object-cover" />}
        <span className="block text-lightbox/60">{label}</span>
        {said}
        <span className="mt-1 block text-proof">✓ Checked against the {e.kind === "frame" ? "keyframe" : "transcript"}</span>
      </span>
    </button>
  );
}

/** A note the checker could not fully confirm: a small marker, its reason in the tooltip. */
export function Unsure({ reason }: { reason: string | null }) {
  return (
    <span tabIndex={0} className="cite group relative ml-1 rounded-sm align-super font-sans text-[0.6875rem] leading-none font-medium text-wait">
      unsure
      <span role="tooltip" className={tip}>{reason ?? "Not fully confirmed by the video"}</span>
    </span>
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Bolds each key term where it first appears; returns the terms that never appeared, to list after the chapter. */
export function boldTerms(texts: string[], terms: string[]): { nodes: ReactNode[][]; rest: string[] } {
  const left = new Set(terms);
  const bold = (text: string, k: number): ReactNode[] => {
    const live = [...left].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!live.length) return [text];
    return text.split(new RegExp(`\\b(${live.map(escape).join("|")})\\b`, "i")).map((part, i) => {
      const term = i % 2 ? live.find((t) => t.toLowerCase() === part.toLowerCase()) : undefined;
      if (!term || !left.delete(term)) return part;
      return <strong key={`${k}-${i}`} className="font-semibold text-ink">{part}</strong>;
    });
  };
  // `code` the article quotes from the notes (a command, formula or output) reads as code; terms bold elsewhere.
  const nodes = texts.map((text) => text.split(/`([^`\n]+)`/).flatMap((part, i): ReactNode[] => i % 2
    ? [<code key={`c${i}`} className="rounded bg-sheet px-1 py-0.5 font-mono text-[0.85em]">{part}</code>]
    : bold(part, i)));
  return { nodes, rest: [...left] };
}

/** One note's sentence followed by its citations. */
export function NoteLine({ note: n, text, seek }: { note: Note; text?: ReactNode; seek: Seek }) {
  return (
    <>
      {text ?? n.text}
      {/* Two quotes in the same second read as one citation. */}
      {n.evidence
        .filter((e, j) => n.evidence.findIndex((f) => f.kind === e.kind && formatTime(f.start_seconds) === formatTime(e.start_seconds)) === j)
        .map((e, j) => <Cite key={j} evidence={e} seek={seek} />)}
      {n.uncertain && <Unsure reason={n.uncertain_reason} />}
    </>
  );
}
