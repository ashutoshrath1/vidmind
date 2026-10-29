"use client";

import { type ReactNode, useEffect, useState } from "react";
import OnScreenLightbox from "@/components/OnScreenLightbox";
import { type Slide, slideText, slidesOf } from "@/components/OnScreenSlides";
import SlidesGlyph from "@/components/SlidesGlyph";
import { Button, type Seek } from "@/components/ui";
import { formatTime } from "@/lib/api";
import { highlight, screenBlocks, screenText, searchFrames } from "@/lib/screen";
import type { View } from "@/lib/trace";

/** What the video showed, slide by slide, like a presenter view: each screen large, and beside it the checked notes
 * about it, what was said while it was up and the text on it, as grouped lists. Search covers all three. */
export default function ScreenText({ view, base, seek }: { view: View; base: string; seek: Seek }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<{ key: string; say: string } | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!view.frames.length || view.keyframesError) return null;
  const slides = slidesOf(view);
  const texts = slides.map((s) => ({ at: s.start, url: s.frames[0].url, text: s.text }));
  const withText = searchFrames(texts, "");
  const q = query.trim();
  const hits = new Set(searchFrames(slides.map((s) => ({ at: s.start, url: s.frames[0].url, text: slideText(s) })), q).map((f) => f.url));
  const shown = q ? slides.filter((s) => hits.has(s.frames[0].url)) : slides;
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
          <h2 className="font-display text-2xl font-semibold tracking-tight">On screen</h2>
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

/** A Settings-style inset group: a quiet caption above, rows on one surface split by hairlines. */
function Group({ title, children, footer }: { title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div>
      <h4 className="px-4 pb-1.5 text-[13px] font-medium text-graphite">{title}</h4>
      <div className="overflow-hidden rounded-[18px] bg-sheet shadow-[0_1px_2px_rgb(0_0_0/0.04)]">{children}</div>
      {footer && <div className="px-4 pt-1.5">{footer}</div>}
    </div>
  );
}
const Row = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`border-b border-rule px-4 py-3 last:border-b-0 ${className}`}>{children}</div>
);

function SlideItem({ s, n, base, seek, query, onOpen, onCopy, copied }: {
  s: Slide; n: number; base: string; seek: Seek; query: string;
  onOpen: () => void; onCopy: (key: string, text: string, say: string) => void; copied?: string;
}) {
  const [moreSaid, setMoreSaid] = useState(false);
  const f = s.frames[0];
  const read = f.read;
  const marked = (t: string) =>
    highlight(t, query).map((p, i) => (p.hit ? <mark key={i} className="rounded-sm bg-marker text-ink">{p.text}</mark> : p.text));
  const long = s.text.length > 200 || s.text.split("\n").length > 6;
  const said = moreSaid || query ? s.said : s.said.slice(0, 3);

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
        <Group title="What the notes say">
          {s.notes.length ? s.notes.map((note, i) => (
            <Row key={i} className="flex gap-3">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-scan" />
              <span className="min-w-0">
                {marked(note.text)}
                {note.uncertain && <span className="ml-1.5 text-[13px] text-strike">Uncertain</span>}
              </span>
            </Row>
          )) : <Row className="text-graphite">No note points at this screen.</Row>}
        </Group>

        {s.said.length > 0 && (
          <Group title="What was said" footer={s.said.length > 3 && !query && (
            <button onClick={() => setMoreSaid(!moreSaid)} aria-expanded={moreSaid} className="hit text-sm font-medium text-scan-ink hover:underline">
              {moreSaid ? "Show less" : `Show all ${s.said.length} lines`}
            </button>
          )}>
            {said.map((l, i) => (
              <Row key={i} className="flex items-baseline gap-3">
                <TimeCapsule t={l.start} seek={seek} />
                <span className="min-w-0">{marked(l.text)}</span>
              </Row>
            ))}
          </Group>
        )}

        <details open={!long || !!query} className="group">
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
