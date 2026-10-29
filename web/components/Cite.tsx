import type { ReactNode } from "react";
import type { Seek } from "@/components/ui";
import { type Evidence, type Note, formatTime } from "@/lib/api";

const tip =
  "pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-max max-w-[min(18rem,80vw)] -translate-x-1/2 rounded-xl bg-ink whitespace-normal px-3 py-2 text-left font-sans text-xs leading-snug font-normal text-lightbox shadow-lg group-hover:block group-focus-visible:block";

/** A quiet citation after a sentence: the time, "on screen" for a frame. The quoted words show on hover and focus. */
export function Cite({ evidence: e, seek }: { evidence: Evidence; seek: Seek }) {
  const said = e.kind === "frame" ? e.text : `“${e.quote}”`;
  const label = `${e.kind === "frame" ? "On screen" : "Said"} at ${formatTime(e.start_seconds)}`;
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
  const nodes = texts.map((text) => {
    const live = [...left].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!live.length) return [text];
    return text.split(new RegExp(`\\b(${live.map(escape).join("|")})\\b`, "i")).map((part, i) => {
      const term = i % 2 ? live.find((t) => t.toLowerCase() === part.toLowerCase()) : undefined;
      if (!term || !left.delete(term)) return part;
      return <strong key={i} className="font-semibold text-ink">{part}</strong>;
    });
  });
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
