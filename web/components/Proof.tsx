"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import ThemeSwitch from "@/components/ThemeSwitch";
import { NotFound } from "@/components/Workspace";
import { Chip, type Seek, TimeButton, YT_ORIGIN, usePlayer } from "@/components/ui";
import { type Evidence, type LearnResult, type Note, formatTime, jobUrl } from "@/lib/api";

// Paper is white whatever the theme: printing swaps the dark tokens for the light ones.
const PRINT_LIGHT =
  "print:[--ink:#111827] print:[--graphite:#4b5563] print:[--rule:#e2e4f0] print:[--sheet:#fff] print:[--lightbox:#fff] print:[--scan:#5b45f0] print:[--scan-ink:#4b33e0] print:[--scan-soft:rgb(91_69_240/0.1)] print:[--strike:#dc2626] print:[--strike-soft:rgb(220_38_38/0.08)]";

/** The read-only page a proof link opens: the notes, each point with its quote or keyframe and a play-from control. */
export default function ProofView({ id, at = 0 }: { id: string; at?: number }) {
  const [result, setResult] = useState<LearnResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "pending" | "error">("loading");
  const base = jobUrl(id);
  const { video, yt, seek } = usePlayer(result?.youtube_id ?? null);

  useEffect(() => {
    let live = true;
    Promise.all([fetch(base), fetch(`${base}/result`)])
      .then(async ([job, res]) => {
        if (job.status === 404) return live && setState("missing");
        if (!res.ok) return live && setState(job.ok ? "pending" : "error");
        const body: LearnResult = await res.json();
        if (!live) return;
        setResult(body);
        setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [base]);

  if (state === "missing") return <NotFound />;
  return (
    <div className={`page-enter flex-1 print:text-ink ${PRINT_LIGHT}`}>
      {/* Exact colour on paper, or the logo's gradient text prints blank. */}
      <header className="border-b border-rule print:[print-color-adjust:exact]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <Logo size={28} />
          <div className="print:hidden"><ThemeSwitch /></div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        {state === "loading" && <p className="scanning rounded-lg bg-sheet p-5 text-graphite ring-1 ring-rule">Opening the notes</p>}
        {state === "pending" && <p className="rounded-lg bg-sheet p-5 text-graphite ring-1 ring-rule">These notes are still being written. Reload in a minute.</p>}
        {state === "error" && <p role="alert" className="rounded-lg bg-strike-soft px-4 py-3 text-strike">Can&apos;t reach VidMind right now. Reload to try again.</p>}
        {result && (
          <>
            <h1 className="max-w-[40ch] font-display text-2xl leading-tight font-bold text-balance sm:text-3xl">{result.title}</h1>
            <p className="mt-2 max-w-[70ch] text-graphite">
              Every point shows its proof: the words said or the frame on screen, and the second it came from.
            </p>
            {result.source === "precomputed" && (
              <p className="mt-4 inline-block rounded-lg bg-scan-soft px-4 py-2 text-sm text-scan-ink ring-1 ring-scan/20">Precomputed sample. Not generated live.</p>
            )}
            {result.tldr && (
              <div className="mt-6 max-w-[70ch] border-l-4 border-scan pl-4">
                <h2 className="font-display text-sm font-semibold text-scan-ink">In short</h2>
                <p className="mt-1 text-lg leading-relaxed">{result.tldr}</p>
              </div>
            )}
            <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="print:hidden lg:sticky lg:top-6 lg:self-start">
                {result.youtube_id ? (
                  <iframe ref={yt} src={`${YT_ORIGIN}/embed/${result.youtube_id}?enablejsapi=1&rel=0${at ? `&start=${at}` : ""}`} title={result.title}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" className="aspect-video w-full rounded-lg bg-black" />
                ) : (
                  <video ref={video} src={`${base}/video${at ? `#t=${at}` : ""}`} controls preload="metadata" className="aspect-video w-full rounded-lg bg-black" />
                )}
              </div>
              <div className="min-w-0 space-y-10">
                {!!result.takeaways?.length && (
                  <section aria-labelledby="takeaways">
                    <h2 id="takeaways" className="font-display text-xl font-semibold">Key takeaways</h2>
                    <Points notes={result.takeaways} base={base} seek={seek} />
                  </section>
                )}
                {result.chapters.map((ch) => (
                  <section key={ch.start_seconds} aria-labelledby={`ch-${Math.round(ch.start_seconds)}`} className="break-inside-avoid-page">
                    <h2 id={`ch-${Math.round(ch.start_seconds)}`} className="flex items-baseline gap-3 font-display text-xl leading-tight font-semibold">
                      <TimeButton t={ch.start_seconds} seek={seek} />
                      {ch.title}
                    </h2>
                    {ch.summary && <p className="mt-2 max-w-[70ch] leading-relaxed text-graphite">{ch.summary}</p>}
                    <Points notes={ch.notes} base={base} seek={seek} />
                  </section>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Points({ notes, base, seek }: { notes: Note[]; base: string; seek: Seek }) {
  return (
    <ol className="mt-3 divide-y divide-rule border-y border-rule">
      {notes.map((n, i) => (
        <li key={i} className="space-y-2 py-4 break-inside-avoid">
          <p className="max-w-[70ch] leading-relaxed">
            {n.text}{" "}
            {n.uncertain && <Chip tone="strike">Uncertain{n.uncertain_reason ? `: ${n.uncertain_reason}` : ""}</Chip>}
          </p>
          <ul aria-label="Proof" className="space-y-2">
            {n.evidence.map((e, j) => <Proof key={j} evidence={e} base={base} seek={seek} />)}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function Proof({ evidence: e, base, seek }: { evidence: Evidence; base: string; seek: Seek }) {
  return (
    <li className="flex items-start gap-3 rounded-lg bg-sheet p-2.5 text-sm ring-1 ring-rule">
      {e.kind === "frame" && e.frame_url && (
        // eslint-disable-next-line @next/next/no-img-element -- frames come from the API host, not the Next app
        <img src={`${base}/${e.frame_url}`} alt={`The video at ${formatTime(e.start_seconds)}`} loading="lazy" className="aspect-video w-24 shrink-0 rounded object-cover sm:w-32" />
      )}
      <p className="min-w-0 flex-1 leading-relaxed break-words">
        {e.kind === "frame" ? (
          <><span className="text-graphite">On screen: </span>{e.text}</>
        ) : (
          <q className="text-ink">{e.quote}</q>
        )}
      </p>
      <TimeButton t={e.start_seconds} seek={seek} />
    </li>
  );
}
