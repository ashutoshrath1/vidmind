"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { Button, type Seek } from "@/components/ui";
import { formatTime } from "@/lib/api";
import { highlight, screenBlocks, screenText, searchFrames } from "@/lib/screen";
import type { View } from "@/lib/trace";

/** Everything read off the screen, searchable and copyable: slides, code, commands and links with their moment. */
export default function ScreenText({ view, base, seek }: { view: View; base: string; seek: Seek }) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<{ key: string; say: string } | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!view.frames.length || view.keyframesError) return null;
  // The read event's own time and image: a trace can renumber frames after the stage listed them.
  const frames = view.frames.flatMap((f) => (f.read ? [{ at: f.read.at, url: f.read.url, text: f.read.text }] : []));
  const withText = searchFrames(frames, "");
  const found = searchFrames(frames, query);
  const reading = !!view.stages.ocr && !view.stages.ocr.end;

  function copy(key: string, text: string, say: string) {
    navigator.clipboard.writeText(text).then(
      () => setCopied({ key, say }),
      () => setCopied({ key: "", say: "Couldn't copy. Select the text instead." }),
    );
  }

  const marked = (text: string) =>
    highlight(text, query).map((p, i) => (p.hit ? <mark key={i} className="rounded-sm bg-marker text-ink">{p.text}</mark> : p.text));

  return (
    <section aria-label="Screen text" className="rounded-lg bg-sheet ring-1 ring-rule">
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display font-semibold">Screen text</h2>
          {withText.length > 0 && (
            <Button variant="quiet" onClick={() => copy("all", screenText(frames), `Copied the screen text of ${withText.length} frames`)}>
              {copied?.key === "all" ? "Copied" : "Copy all screen text"}
            </Button>
          )}
        </div>
        <p aria-live="polite" className="sr-only">{copied?.say}</p>
        {!withText.length ? (
          <p className={`rounded-lg bg-lightbox p-3 text-sm text-graphite ${reading ? "scanning" : ""}`}>
            {reading ? "Reading the text on each keyframe" : "No keyframe in this video has text on screen."}
          </p>
        ) : (
          <>
            <label className="relative block">
              <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-graphite" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100}
                placeholder="Search what was on screen…" aria-label="Search what was on screen"
                className="min-h-11 w-full rounded-full bg-lightbox pr-4 pl-10 text-sm ring-1 ring-rule placeholder:text-graphite focus:ring-2 focus:ring-scan focus:outline-none" />
            </label>
            <p aria-live="polite" className="tabular text-xs text-graphite">
              {query.trim()
                ? found.length ? `${found.length} of ${withText.length} frames match` : `Nothing on screen matches “${query.trim()}”.`
                : `${withText.length} frames with text`}
            </p>
            <ul className="space-y-3">
              {found.map((f, n) => (
                <li key={`${n}-${f.url}`} className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                  <button onClick={() => seek(f.at)} aria-label={`Play from ${formatTime(f.at)}`}
                    className="relative block h-fit w-28 shrink-0 overflow-hidden rounded bg-black ring-2 ring-transparent transition hover:ring-scan">
                    {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
                    <img src={`${base}/${f.url}`} alt="" className="aspect-video w-full object-cover" />
                    <span className="tabular absolute bottom-0.5 left-0.5 rounded-sm bg-black/70 px-1 font-mono text-[10px] text-white">{formatTime(f.at)}</span>
                  </button>
                  <div className="min-w-0 flex-1 space-y-2">
                    {screenBlocks(f.text).map((b, i) => {
                      const key = `${f.url}#${i}`;
                      return b.code ? (
                        <div key={i} className="flex items-start gap-2 rounded bg-lightbox p-2 ring-1 ring-rule">
                          <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-sm leading-relaxed"><code>{marked(b.text)}</code></pre>
                          <button onClick={() => copy(key, b.text, `Copied the code at ${formatTime(f.at)}`)} aria-label={`Copy code at ${formatTime(f.at)}`}
                            className="hit shrink-0 rounded-full bg-sheet px-2.5 py-0.5 font-display text-xs font-semibold ring-1 ring-rule hover:ring-scan">
                            {copied?.key === key ? "Copied" : "Copy"}
                          </button>
                        </div>
                      ) : (
                        <p key={i} className={`text-sm leading-relaxed ${query.trim() ? "" : "line-clamp-3"}`}>{marked(b.text)}</p>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
