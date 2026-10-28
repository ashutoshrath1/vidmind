"use client";

import { useEffect, useState } from "react";
import { Counter } from "@/components/ui";
import { type LearnResult, type Note, type Rejected, formatTime } from "@/lib/api";
import type { View } from "@/lib/trace";

/** How many notes the models wrote, how many the video backs up, and what was removed and why.
 * Built from the trace when there is one (so it fills up live and in a replay), else from the saved result. */
export default function EvidenceMeter({ result, view, running }: { result: LearnResult | null; view: View; running: boolean }) {
  const traced = view.sections.length > 0;
  const done = view.sections.filter((s) => s.done?.ok);
  // The check events of the model that won each section.
  const winning = done.flatMap((s) => s.checks.filter((c) => c.model === s.done!.model));
  const kept = traced ? done.reduce((n, s) => n + s.done!.notes, 0) : (result?.chapters.reduce((n, c) => n + c.notes.length, 0) ?? 0);
  const rejected: Rejected[] = traced ? winning.flatMap((c) => c.rejected ?? []) : (result?.rejected ?? []);
  const sentBack = traced ? winning.filter((c) => c.round === 1).reduce((n, c) => n + c.problems.length, 0) : (result?.citations_rechecked ?? 0);
  const doneStarts = new Set(done.map((s) => Math.round(s.lo)));
  const citations =
    result?.chapters
      .filter((c) => !traced || doneStarts.has(Math.round(c.start_seconds)))
      .reduce((n, c) => n + c.notes.reduce((m, x) => m + x.evidence.length, 0), 0) ?? 0;
  const proposed = kept + rejected.length;
  if (!proposed) return null;
  if (!traced && !result?.notes_checked) return null; // results from before the audit existed
  const pct = Math.round((100 * kept) / proposed);

  const facts = result?.chapters.flatMap((c) => c.notes).filter((n) => n.evidence.length) ?? [];

  return (
    <section aria-label="Fact check" className="space-y-3 rounded-lg bg-sheet p-3 ring-1 ring-rule">
      <div className="flex items-center gap-3">
        <Ring pct={pct} bad={rejected.length / proposed} />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold">
            <Counter value={kept} />/<Counter value={proposed} /> notes proven{running ? " so far" : ""}
          </p>
          <p className="flex flex-wrap gap-x-3 text-xs text-graphite">
            <span><b className="tabular text-proof"><Counter value={citations} /></b> citations matched</span>
            <span><b className="tabular text-scan-ink"><Counter value={sentBack} /></b> fixed</span>
            <span><b className="tabular text-strike"><Counter value={rejected.length} /></b> thrown out</span>
          </p>
        </div>
      </div>
      {facts.length > 0 && !running && <FactTicker facts={facts} />}
      {rejected.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-scan-ink">Why {rejected.length === 1 ? "one was" : `${rejected.length} were`} thrown out</summary>
          <ul className="mt-2 space-y-1.5">
            {rejected.map((r, i) => (
              <li key={i} className="rounded bg-strike-soft p-2 text-xs">
                <p className="line-through decoration-strike">{r.text}</p>
                <p className="mt-0.5 text-graphite">{r.reasons.join("; ")}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The verified share as a ring that fills; the thrown-out share shows in red. */
function Ring({ pct, bad }: { pct: number; bad: number }) {
  const C = 2 * Math.PI * 26;
  return (
    <svg viewBox="0 0 64 64" className="size-12 shrink-0 -rotate-90" role="img" aria-label={`${pct} percent proven`}>
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="7" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--proof)" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-1000 ease-out" />
      {bad > 0 && <circle cx="32" cy="32" r="26" fill="none" stroke="var(--strike)" strokeWidth="7" strokeDasharray={`${C * bad} ${C}`} strokeDashoffset={-C * (pct / 100)} />}
      <text x="32" y="37" textAnchor="middle" className="rotate-90 fill-current font-display text-[17px] font-bold" style={{ transformOrigin: "32px 32px" }}>
        {pct}%
      </text>
    </svg>
  );
}

/** One proven note at a time, with where the video proves it, stamped as it flips in. */
function FactTicker({ facts }: { facts: Note[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % facts.length), 4000);
    return () => clearInterval(id);
  }, [facts.length]);
  const f = facts[i % facts.length];
  const e = f.evidence[0];
  return (
    <p key={i} className="arrive flex items-center gap-2 rounded bg-lightbox px-2 py-1.5 text-xs" aria-live="off" title={f.text}>
      <span className="stamp shrink-0 rounded border border-proof px-1 font-display font-bold text-proof">✓</span>
      <span className="min-w-0 flex-1 truncate">{f.text}</span>
      <span className="tabular shrink-0 font-mono text-graphite">{e.kind === "frame" ? "seen" : "said"} {formatTime(e.start_seconds)}</span>
    </p>
  );
}
