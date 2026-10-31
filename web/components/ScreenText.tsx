"use client";

import { type ReactNode, useEffect, useState } from "react";
import OnScreenLightbox from "@/components/OnScreenLightbox";
import { type Slide, explain, isFiller, isQuiet, slideText, slidesOf } from "@/components/OnScreenSlides";
import SlidesGlyph from "@/components/SlidesGlyph";
import { Button, type Seek } from "@/components/ui";
import { type LearnResult, formatTime } from "@/lib/api";
import { highlight, screenBlocks, screenText, searchFrames } from "@/lib/screen";
import type { View } from "@/lib/trace";

/** "The slides, explained": each screen large, beside it the model's explanation of it (result.slides), else the checked
 * notes about it; the transcript and screen text stay folded. Logo and blank screens fold into one quiet row. */
export default function ScreenText({ view, base, seek }: { view: View; base: string; seek: Seek }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<{ key: string; say: string } | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  // Workspace passes only the trace, so read the explanations from the result once the run is over.
  const [explained, setExplained] = useState<LearnResult["slides"]>();
  const ended = !!view.end;
  useEffect(() => {
    if (!ended) return;
    let live = true;
    fetch(`${base}/result`).then((r) => (r.ok ? r.json() : null)).then((r: LearnResult | null) => live && setExplained(r?.slides)).catch(() => {});
    return () => { live = false; };
  }, [base, ended]);

  if (!view.frames.length || view.keyframesError) return null;
  const slides = explain(slidesOf(view), explained);
  const texts = slides.map((s) => ({ at: s.start, url: s.frames[0].url, text: s.text }));
  const withText = searchFrames(texts, "");
  const q = query.trim();
  const hits = new Set(searchFrames(slides.map((s) => ({ at: s.start, url: s.frames[0].url, text: slideText(s) })), q).map((f) => f.url));
  const shown = q ? slides.filter((s) => hits.has(s.frames[0].url)) : slides.filter((s) => !isQuiet(s, !!explained?.length));
  const quiet = q ? [] : slides.filter((s) => isQuiet(s, !!explained?.length));
  const reading = !!view.stages.ocr && !view.stages.ocr.end;
  const readCount = view.frames.filter((f) => f?.read).length;

  function copy(key: string, text: string, say: string) {
    navigator.clipboard.writeText(text).then(
      () => setCopied({ key, say }),
      () => setCopied({ key: "", say: "Couldn't copy. Select the text instead." }),
    );
  }

  return (
    <section aria-label="On screen" className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">The slides, explained</h2>
          <p className="tabular mt-0.5 text-sm text-graphite">
            {reading ? `Reading screens, ${readCount} of ${view.frames.length}` : `${slides.length} screens, in order`}
          </p>
        </div>
        {withText.length > 0 && (
          <Button variant="quiet" onClick={() => copy("all", screenText(texts), `Copied the screen text of ${withText.length} screens`)}>
            {copied?.key === "all" ? "Copied" : "Copy all screen text"}
          </Button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">{copied?.say}</p>

      <div role="search" className="relative">
        <SlidesGlyph name="search" className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-graphite" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder="Search slides, speech and notes" aria-label="Search what was on screen"
          className="h-11 w-full rounded-xl bg-[color-mix(in_srgb,var(--graphite)_14%,transparent)] pr-10 pl-10 text-base text-ink placeholder:text-graphite focus:ring-2 focus:ring-scan focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
        {query && (
          <button onClick={() => setQuery("")} aria-label="Clear search"
            className="hit absolute top-1/2 right-2.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-graphite hover:text-ink">
            <SlidesGlyph name="clear" className="size-[18px]" />
          </button>
        )}
      </div>
      {q && (
        <p aria-live="polite" className="tabular text-sm text-graphite">
          {shown.length ? `${shown.length} of ${slides.length} screens match` : `Nothing on screen matches “${q}”.`}
        </p>
      )}

      <ol className="space-y-14">
        {shown.map((s) => {
          const n = slides.indexOf(s);
          return <SlideItem key={s.frames[0].url + s.start} s={s} n={n} base={base} seek={seek} query={q}
            onOpen={() => setOpen(n)} onCopy={copy} copied={copied?.key} />;
        })}
      </ol>
      {quiet.length > 0 && (
        <details className="group rounded-[18px] bg-sheet shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
          <summary className="hit flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[15px] text-graphite [&::-webkit-details-marker]:hidden">
            <span>{quiet.length} more {quiet.length === 1 ? "screen" : "screens"}: titles, logos and blank frames</span>
            <SlidesGlyph name="right" className="size-3.5 transition-transform duration-300 ease-spring group-open:rotate-90 motion-reduce:transition-none" />
          </summary>
          <ul className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
            {quiet.map((s) => (
              <li key={s.frames[0].url + s.start}>
                <button onClick={() => setOpen(slides.indexOf(s))} aria-label={`Open the screen at ${formatTime(s.start)} full size`}
                  className="block w-full overflow-hidden rounded-xl bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scan">
                  {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
                  <img src={`${base}/${s.frames[0].url}`} width={320} height={180} loading="lazy" alt="" className="w-full" />
                </button>
                <span className="tabular mt-1 block text-[13px] text-graphite">{formatTime(s.start)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {open !== null && <OnScreenLightbox frames={slides.map((s) => s.frames[0])} at={open} go={setOpen} close={() => setOpen(null)} base={base} seek={seek} />}
    </section>
  );
}

/** A small capsule that plays the video from a moment. */
export function TimeCapsule({ t, seek, dark = false }: { t: number; seek: Seek; dark?: boolean }) {
  return (
    <button onClick={() => seek(t)} aria-label={`Play from ${formatTime(t)}`}
      className={`hit tabular inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[13px] font-semibold transition-colors ${dark ? "bg-white/15 text-white hover:bg-white/25" : "bg-scan-soft text-scan-ink hover:bg-scan hover:text-on-scan"}`}>
      <SlidesGlyph name="play" className="size-2.5" />
      {formatTime(t)}
    </button>
  );
}

/** A Settings-style inset group, folded under a quiet caption. */
function Fold({ title, children, open }: { title: ReactNode; children: ReactNode; open: boolean }) {
  return (
    <details open={open} className="group/f">
      <summary className="hit flex cursor-pointer list-none items-center gap-1 px-4 pb-1.5 text-[13px] font-medium text-graphite [&::-webkit-details-marker]:hidden">
        {title}
        <SlidesGlyph name="right" className="size-3 transition-transform duration-300 ease-spring group-open/f:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="overflow-hidden rounded-[18px] bg-sheet shadow-[0_1px_2px_rgb(0_0_0/0.04)]">{children}</div>
    </details>
  );
}
const Row = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`border-b border-rule px-4 py-3 last:border-b-0 ${className}`}>{children}</div>
);

function SlideItem({ s, n, base, seek, query, onOpen, onCopy, copied }: {
  s: Slide; n: number; base: string; seek: Seek; query: string;
  onOpen: () => void; onCopy: (key: string, text: string, say: string) => void; copied?: string;
}) {
  const f = s.frames[0];
  const read = f.read;
  const marked = (t: string) =>
    highlight(t, query).map((p, i) => (p.hit ? <mark key={i} className="rounded-sm bg-marker text-ink">{p.text}</mark> : p.text));
  const said = s.said.filter((l) => !isFiller(l));
  const ex = s.explained;

  return (
    <li className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:self-start">
        <button onClick={onOpen} aria-label={`Open the screen at ${formatTime(s.start)} full size`}
          className="group block w-full overflow-hidden rounded-[20px] bg-black shadow-[0_2px_12px_rgb(0_0_0/0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scan">
          {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
          <img src={`${base}/${f.url}`} width={1280} height={720} loading={n < 2 ? "eager" : "lazy"} alt={`The screen at ${formatTime(s.start)}`}
            className={`w-full transition duration-500 ease-spring group-hover:scale-[1.015] motion-reduce:transition-none ${read ? "" : "opacity-70"}`} />
        </button>
        <div className="tabular flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-sm text-graphite">
          <span className="font-display font-semibold text-ink">Slide {n + 1}</span>
          <TimeCapsule t={s.start} seek={seek} />
          {Number.isFinite(s.end) && <span>on screen {formatTime(s.start)}–{formatTime(s.end)}</span>}
          {!read && <span className="text-wait">Reading…</span>}
          {read?.low_conf && <span className="text-strike">Hard to read</span>}
        </div>
      </div>

      <div className="min-w-0 space-y-6 text-[15px] leading-relaxed">
        {ex ? (
          <div className="space-y-3">
            <h3 className="font-display text-2xl leading-tight font-semibold tracking-tight text-balance">{marked(ex.title)}</h3>
            <p className="font-serif text-[19px] leading-[1.6] text-ink">{marked(ex.explanation)}</p>
            {s.notes.length > 0 && (
              <Fold title={<span className="inline-flex items-center gap-1 text-proof"><SlidesGlyph name="check" className="size-4" />In the notes</span>} open={!!query}>
                {s.notes.map((note, i) => <Row key={i}>{marked(note.text)}</Row>)}
              </Fold>
            )}
          </div>
        ) : s.notes.length > 0 && (
          <ul className="space-y-3 font-serif text-[19px] leading-[1.6]">
            {s.notes.map((note, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden className="mt-3 size-1.5 shrink-0 rounded-full bg-scan" />
                <span className="min-w-0">
                  {marked(note.text)}
                  {note.uncertain && <span className="ml-1.5 font-sans text-[13px] text-strike">Uncertain</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {said.length > 0 && (
          <Fold title={<>Transcript <span className="tabular font-normal">· {said.length}</span></>} open={!!query}>
            {said.map((l, i) => (
              <Row key={i} className="flex items-baseline gap-3">
                <TimeCapsule t={l.start} seek={seek} />
                <span className="min-w-0">{marked(l.text)}</span>
              </Row>
            ))}
          </Fold>
        )}

        <details open={!!query} className="group">
          <summary className="hit flex cursor-pointer list-none items-center gap-1 px-4 pb-1.5 text-[13px] font-medium text-graphite marker:hidden [&::-webkit-details-marker]:hidden">
            Text on screen
            <SlidesGlyph name="right" className="size-3 transition-transform duration-300 ease-spring group-open:rotate-90 motion-reduce:transition-none" />
          </summary>
          <div className="overflow-hidden rounded-[18px] bg-sheet shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
            {read && !s.text && <Row className="text-graphite">No text on this screen.</Row>}
            {!read && <Row className="text-graphite">Reading this screen…</Row>}
            {s.text && screenBlocks(s.text).map((b, i) => {
              const key = `${f.url}#${i}`;
              return b.code ? (
                <Row key={i} className="flex items-start gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] leading-relaxed"><code>{marked(b.text)}</code></pre>
                  <button onClick={() => onCopy(key, b.text, `Copied the code at ${formatTime(s.start)}`)} aria-label={`Copy code at ${formatTime(s.start)}`}
                    className="hit shrink-0 rounded-full bg-scan-soft px-2.5 py-0.5 text-[13px] font-semibold text-scan-ink hover:bg-scan hover:text-on-scan">
                    {copied === key ? "Copied" : "Copy"}
                  </button>
                </Row>
              ) : <Row key={i} className="text-graphite">{marked(b.text)}</Row>;
            })}
            {read?.figure && (
              <Row>
                {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
                <img src={`${base}/${read.figure}`} loading="lazy" alt={`The diagram at ${formatTime(s.start)}, cropped`}
                  className="max-h-64 w-full rounded-xl bg-white object-contain" />
              </Row>
            )}
          </div>
        </details>
      </div>
    </li>
  );
}
