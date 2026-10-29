"use client";

import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { type Evidence, formatTime } from "@/lib/api";

export type Seek = (t: number) => void;

export const YT_ORIGIN = "https://www.youtube-nocookie.com";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet";
  working?: boolean; // the AI is busy on this action: the scan line runs across the button
};

export function Button({ variant = "primary", working = false, className = "", children, ...props }: ButtonProps) {
  const look =
    variant === "primary"
      ? "bg-scan text-on-scan hover:brightness-110 disabled:bg-graphite/30 disabled:text-graphite"
      : "bg-graphite/12 text-ink hover:bg-graphite/20";
  return (
    <button
      aria-busy={working || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 font-display font-semibold transition active:translate-y-px disabled:cursor-not-allowed ${look} ${working ? "scanning" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "w-full rounded-lg bg-sheet px-4 py-3 text-ink ring-1 ring-rule placeholder:text-graphite/80 transition focus:outline-none focus:ring-2 focus:ring-scan disabled:opacity-60";

type Tone = "plain" | "scan" | "proof" | "strike";
const tones: Record<Tone, string> = {
  plain: "bg-lightbox text-graphite",
  scan: "bg-scan-soft text-scan-ink",
  proof: "bg-proof-soft text-proof",
  strike: "bg-strike-soft text-strike",
};

export function Chip({ tone = "plain", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`tabular inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function TimeButton({ t, seek, label }: { t: number; seek: Seek; label?: string }) {
  return (
    <button
      onClick={() => seek(t)}
      aria-label={`Play from ${formatTime(t)}`}
      className="hit tabular rounded bg-scan-soft px-1.5 font-mono text-sm font-semibold text-scan-ink hover:bg-scan hover:text-on-scan"
    >
      {label ?? formatTime(t)}
    </button>
  );
}

/** One piece of proof as a small pill: a quote mark or a tiny keyframe, and the time. The quote or screen text shows
 * on hover and keyboard focus (and is in the accessible name); click to play from that moment. */
export function EvidenceChip({ evidence: e, base, seek }: { evidence: Evidence; base: string; seek: Seek }) {
  const said = e.kind === "frame" ? e.text : `“${e.quote}”`;
  const label = `${e.kind === "frame" ? "On screen" : "Said"} at ${formatTime(e.start_seconds)}`;
  return (
    <button
      onClick={() => seek(e.start_seconds)}
      aria-label={`${label}: ${said}. Play from here`}
      data-seek={e.start_seconds}
      className="group relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-lightbox px-2 text-xs ring-1 ring-rule transition hover:ring-scan focus-visible:ring-scan"
    >
      {e.kind === "frame" && e.frame_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- frames come from the API host, not the Next app
        <img src={`${base}/${e.frame_url}`} alt="" className="h-4 w-6 rounded-sm object-cover" />
      ) : (
        <span aria-hidden className="font-display text-sm leading-none text-scan-ink">“</span>
      )}
      <span className="tabular font-mono text-graphite group-hover:text-scan-ink">{formatTime(e.start_seconds)}</span>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-30 mb-1.5 hidden w-max max-w-72 rounded-md bg-ink px-2.5 py-1.5 text-left text-xs leading-snug text-lightbox shadow-lg group-hover:block group-focus-visible:block">
        <span className="block font-mono text-lightbox/60">{label}</span>
        {said}
      </span>
    </button>
  );
}

/** A number that counts to its new value instead of jumping (instant with reduced motion). */
export function Counter({ value, format = (n: number) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const start = current.current;
    const instant = start === value || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const k = instant ? 1 : Math.min(1, (now - t0) / 600);
      current.current = start + (value - start) * (1 - (1 - k) ** 3);
      setShown(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="tabular">{format(shown)}</span>;
}
