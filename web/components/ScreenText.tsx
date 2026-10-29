"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import OnScreenLightbox from "@/components/OnScreenLightbox";
import { Button, type Seek, TimeButton } from "@/components/ui";
import { formatTime } from "@/lib/api";
import { highlight, screenBlocks, screenText, searchFrames } from "@/lib/screen";
import type { FrameView, View } from "@/lib/trace";

/** What the video showed: every screen in time order, large enough to read, with its text. Search filters and marks
 * the cards; a card's image opens it full screen. */
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
  // The read event's own time (a trace can renumber frames after the stage listed them), the stage's image: some
  // read events name a file the sample never shipped.
  const all: FrameView[] = view.frames.map((f) => (f.read ? { ...f, at: f.read.at } : f));
  const texts = all.flatMap((f) => (f.read ? [{ at: f.at, url: f.url, text: f.read.text }] : []));
  const withText = searchFrames(texts, "");
  const q = query.trim();
  const hits = new Set(searchFrames(texts, q).map((f) => f.url));
  const shown = q ? all.filter((f) => hits.has(f.url)) : all;
  const reading = !!view.stages.ocr && !view.stages.ocr.end;
  const readCount = all.filter((f) => f.read).length;

  function copy(key: string, text: string, say: string) {
    navigator.clipboard.writeText(text).then(
      () => setCopied({ key, say }),
      () => setCopied({ key: "", say: "Couldn't copy. Select the text instead." }),
    );
  }

  return (
    <section aria-label="On screen" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold">On screen</h2>
          <p className="tabular text-xs text-graphite">
            {reading ? `Reading screens, ${readCount} of ${all.length}` : `${all.length} screens, in order`}
          </p>
        </div>
        {withText.length > 0 && (
          <Button variant="quiet" onClick={() => copy("all", screenText(texts), `Copied the screen text of ${withText.length} screens`)}>
            {copied?.key === "all" ? "Copied" : "Copy all screen text"}
          </Button>
        )}
      </div>
      <p aria-live="polite" className="sr-only">{copied?.say}</p>
      {withText.length > 0 && (
          <label className="relative block">
            {/* z-10: the glass input's backdrop filter would paint over the icon */}
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-graphite" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100}
              placeholder="Search what was on screen…" aria-label="Search what was on screen"
              className="glass min-h-11 w-full rounded-full pr-4 pl-10 text-sm ring-1 ring-rule placeholder:text-graphite focus:ring-2 focus:ring-scan focus:outline-none" />
          </label>
      )}
      {q && (
        <p aria-live="polite" className="tabular text-sm text-graphite">
          {shown.length ? `${shown.length} of ${withText.length} frames match` : `Nothing on screen matches “${q}”.`}
        </p>
      )}
      {!reading && !withText.length && <p className="text-sm text-graphite">No screen in this video has text on it.</p>}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((f) => (
          <Card key={f.i} f={f} n={all.indexOf(f)} base={base} seek={seek} query={q} reading={reading}
            onOpen={() => setOpen(all.indexOf(f))} onCopy={copy} copied={copied?.key} />
        ))}
      </ul>
      {open !== null && <OnScreenLightbox frames={all} at={open} go={setOpen} close={() => setOpen(null)} base={base} seek={seek} />}
    </section>
  );
}

function Card({ f, n, base, seek, query, reading, onOpen, onCopy, copied }: {
  f: FrameView; n: number; base: string; seek: Seek; query: string; reading: boolean;
  onOpen: () => void; onCopy: (key: string, text: string, say: string) => void; copied?: string;
}) {
  const [more, setMore] = useState(false);
  const read = f.read;
  const text = read?.text.trim() ?? "";
  const long = text.length > 280 || text.split("\n").length > 6;
  const marked = (t: string) =>
    highlight(t, query).map((p, i) => (p.hit ? <mark key={i} className="rounded-sm bg-marker text-ink">{p.text}</mark> : p.text));

  return (
    <li className={`glass overflow-hidden rounded-2xl ring-1 ring-rule ${read ? (reading ? "flash" : "") : "scanning"}`}>
      <button onClick={onOpen} aria-label={`Open the screen at ${formatTime(f.at)} full size`}
        className="group relative block w-full bg-black focus-visible:outline-2 focus-visible:outline-scan">
        {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
        <img src={`${base}/${f.url}`} width={1280} height={720} loading={n < 3 ? "eager" : "lazy"} alt={`The screen at ${formatTime(f.at)}`}
          className="arrive aspect-video w-full object-contain transition group-hover:opacity-90 motion-reduce:transition-none" />
        {read?.figure && <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">Diagram</span>}
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <TimeButton t={f.at} seek={seek} />
          {!read && <span className="text-xs text-graphite">Reading…</span>}
          {read?.low_conf && <span className="text-xs text-strike">Hard to read</span>}
        </div>
        {read && !text && <p className="text-sm text-graphite">No text on this screen.</p>}
        {text && (
          <div className={`space-y-2 text-[15px] leading-relaxed ${long && !more && !query ? "line-clamp-5" : ""}`}>
            {screenBlocks(text).map((b, i) => {
              const key = `${f.url}#${i}`;
              return b.code ? (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-lightbox p-2 ring-1 ring-rule">
                  <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-sm"><code>{marked(b.text)}</code></pre>
                  <button onClick={() => onCopy(key, b.text, `Copied the code at ${formatTime(f.at)}`)} aria-label={`Copy code at ${formatTime(f.at)}`}
                    className="hit shrink-0 rounded-full bg-sheet px-2.5 py-0.5 font-display text-xs font-semibold ring-1 ring-rule hover:ring-scan">
                    {copied === key ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : <p key={i}>{marked(b.text)}</p>;
            })}
          </div>
        )}
        {long && !query && (
          <button onClick={() => setMore(!more)} aria-expanded={more} className="hit text-sm font-semibold text-scan-ink hover:underline">
            {more ? "Show less" : "Show all"}
          </button>
        )}
      </div>
    </li>
  );
}
