"use client";

import { type ReactNode, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import OnScreenLightbox from "@/components/OnScreenLightbox";
import { type Slide, slideText, slidesOf } from "@/components/OnScreenSlides";
import { Button, type Seek, TimeButton } from "@/components/ui";
import { formatTime } from "@/lib/api";
import { highlight, screenBlocks, screenText, searchFrames } from "@/lib/screen";
import type { View } from "@/lib/trace";

/** What the video showed, slide by slide: each screen with the checked notes about it, what was said while it was up
 * and the text on it. Search covers all three and marks the matches; a slide's image opens it full screen. */
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold">On screen</h2>
          <p className="tabular text-xs text-graphite">
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
      <label className="relative block">
        {/* z-10: the glass input's backdrop filter would paint over the icon */}
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-graphite" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100}
          placeholder="Search the slides, what was said, the notes…" aria-label="Search what was on screen"
          className="glass min-h-11 w-full rounded-full pr-4 pl-10 text-sm ring-1 ring-rule placeholder:text-graphite focus:ring-2 focus:ring-scan focus:outline-none" />
      </label>
      {q && (
        <p aria-live="polite" className="tabular text-sm text-graphite">
          {shown.length ? `${shown.length} of ${slides.length} screens match` : `Nothing on screen matches “${q}”.`}
        </p>
      )}
      <ol className="space-y-12">
        {shown.map((s) => {
          const n = slides.indexOf(s);
          return <SlideItem key={s.frames[0].url + s.start} s={s} n={n} base={base} seek={seek} query={q} reading={reading}
            onOpen={() => setOpen(n)} onCopy={copy} copied={copied?.key} />;
        })}
      </ol>
      {open !== null && <OnScreenLightbox frames={slides.map((s) => s.frames[0])} at={open} go={setOpen} close={() => setOpen(null)} base={base} seek={seek} />}
    </section>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <h4 className="text-xs font-semibold tracking-wide text-graphite uppercase">{children}</h4>
);

function SlideItem({ s, n, base, seek, query, reading, onOpen, onCopy, copied }: {
  s: Slide; n: number; base: string; seek: Seek; query: string; reading: boolean;
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
    <li className={`grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] ${read ? (reading ? "flash" : "") : "scanning rounded-2xl"}`}>
      <div className="min-w-0 space-y-2 lg:sticky lg:top-20 lg:self-start">
        <button onClick={onOpen} aria-label={`Open the screen at ${formatTime(s.start)} full size`}
          className="group block w-full overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scan">
          {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
          <img src={`${base}/${f.url}`} width={1280} height={720} loading={n < 2 ? "eager" : "lazy"} alt={`The screen at ${formatTime(s.start)}`}
            className="arrive w-full transition group-hover:opacity-90 motion-reduce:transition-none" />
        </button>
        <p className="tabular flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite">
          <span className="font-display font-semibold text-ink">{n + 1}</span>
          <TimeButton t={s.start} seek={seek} />
          {Number.isFinite(s.end) && <span>shown {formatTime(s.start)}–{formatTime(s.end)}</span>}
          {!read && <span>· Reading…</span>}
          {read?.low_conf && <span className="text-strike">· Hard to read</span>}
        </p>
      </div>

      <div className="min-w-0 space-y-5 text-[15px] leading-relaxed">
        <div className="space-y-2">
          <Label>What the notes say</Label>
          {s.notes.length ? (
            <ul className="space-y-2">
              {s.notes.map((note, i) => (
                <li key={i} className="border-l-2 border-scan pl-3">
                  {marked(note.text)}
                  {note.uncertain && <span className="ml-1 text-xs text-strike">(uncertain)</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-graphite">No note points at this screen.</p>}
        </div>

        {s.said.length > 0 && (
          <div className="space-y-2">
            <Label>What was said</Label>
            <ul className="space-y-1.5">
              {said.map((l, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <TimeButton t={l.start} seek={seek} />
                  <span className="min-w-0 text-ink/90">{marked(l.text)}</span>
                </li>
              ))}
            </ul>
            {s.said.length > 3 && !query && (
              <button onClick={() => setMoreSaid(!moreSaid)} aria-expanded={moreSaid} className="hit text-sm font-semibold text-scan-ink hover:underline">
                {moreSaid ? "Show less" : `All ${s.said.length} lines`}
              </button>
            )}
          </div>
        )}

        <details open={!long || !!query} className="group space-y-2">
          <summary className="hit cursor-pointer list-none text-xs font-semibold tracking-wide text-graphite uppercase marker:hidden">
            Text on screen <span className="font-normal normal-case tracking-normal text-scan-ink group-open:hidden">· show</span>
          </summary>
          {read && !s.text && <p className="text-sm text-graphite">No text on this screen.</p>}
          {s.text && (
            <div className="mt-2 space-y-2">
              {screenBlocks(s.text).map((b, i) => {
                const key = `${f.url}#${i}`;
                return b.code ? (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-lightbox p-2">
                    <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-sm"><code>{marked(b.text)}</code></pre>
                    <button onClick={() => onCopy(key, b.text, `Copied the code at ${formatTime(s.start)}`)} aria-label={`Copy code at ${formatTime(s.start)}`}
                      className="hit shrink-0 rounded-full bg-sheet px-2.5 py-0.5 font-display text-xs font-semibold ring-1 ring-rule hover:ring-scan">
                      {copied === key ? "Copied" : "Copy"}
                    </button>
                  </div>
                ) : <p key={i} className="text-graphite">{marked(b.text)}</p>;
              })}
            </div>
          )}
          {read?.figure && (
            // eslint-disable-next-line @next/next/no-img-element -- frames come from the API host
            <img src={`${base}/${read.figure}`} loading="lazy" alt={`The diagram at ${formatTime(s.start)}, cropped`}
              className="mt-2 max-h-64 w-full rounded-lg bg-white object-contain" />
          )}
        </details>
      </div>
    </li>
  );
}
