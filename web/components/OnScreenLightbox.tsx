"use client";

import { useEffect, useRef, useState } from "react";
import { type Seek, TimeButton } from "@/components/ui";
import { formatTime } from "@/lib/api";
import { screenBlocks } from "@/lib/screen";
import type { FrameView } from "@/lib/trace";

/** One slide full screen: the big frame, its diagram crop, all its text. A native modal dialog traps focus, closes on
 * Esc and hands focus back to the card that opened it; arrow keys step through the slides. */
export default function OnScreenLightbox({ frames, at, go, close, base, seek }: {
  frames: FrameView[]; at: number; go: (i: number) => void; close: () => void; base: string; seek: Seek;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    // No close() on cleanup: under StrictMode its close event would shut the box the remount just opened.
    const back = document.activeElement as HTMLElement | null;
    ref.current!.showModal();
    return () => back?.focus();
  }, []);
  const f = frames[at];
  if (!f) return null;
  const step = (d: number) => go((at + d + frames.length) % frames.length);
  const read = f.read;

  return (
    <dialog ref={ref} onClose={close} aria-label={`Screen at ${formatTime(f.at)}`}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="m-auto h-dvh max-h-none w-full max-w-none bg-[color-mix(in_srgb,var(--sheet)_92%,transparent)] p-0 text-ink backdrop-blur-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:h-[92dvh] sm:w-[94vw] sm:rounded-2xl sm:ring-1 sm:ring-rule">
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-rule px-4 py-2.5">
          <h2 className="tabular font-display font-semibold">{formatTime(f.at)}</h2>
          <span className="tabular text-xs whitespace-nowrap text-graphite">{at + 1} of {frames.length}</span>
          <TimeButton t={f.at} seek={seek} label="▶ Play" />
          <span className="flex-1" />
          <button onClick={() => step(-1)} aria-label="Previous screen" className="hit rounded-full px-3 py-1 text-lg ring-1 ring-rule hover:ring-scan">‹</button>
          <button onClick={() => step(1)} aria-label="Next screen" className="hit rounded-full px-3 py-1 text-lg ring-1 ring-rule hover:ring-scan">›</button>
          <button onClick={close} aria-label="Close" autoFocus className="hit rounded-full px-3 py-1 font-display text-sm font-semibold ring-1 ring-rule hover:ring-scan">Close</button>
        </header>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-3">
            <span className="relative block overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
              <img key={f.url} src={`${base}/${f.url}`} width={1280} height={720} alt={`The screen at ${formatTime(f.at)}`} className="arrive w-full object-contain" />
              {read?.figure && read.box && <Outline box={read.box} src={`${base}/${f.url}`} />}
            </span>
            {read?.figure && (
              <figure className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
                <img src={`${base}/${read.figure}`} alt={`The diagram at ${formatTime(f.at)}, enlarged`} className="max-h-[50dvh] w-full rounded-lg bg-white object-contain ring-1 ring-rule" />
                <figcaption className="text-xs text-graphite">The diagram on this screen, enlarged.</figcaption>
              </figure>
            )}
          </div>
          <div className="space-y-3 text-base leading-relaxed">
            {!read ? <p className="scanning rounded-lg bg-lightbox p-3 text-sm text-graphite">Reading this screen…</p>
              : !read.text.trim() ? <p className="text-sm text-graphite">No text on this screen.</p>
              : screenBlocks(read.text).map((b, i) => b.code
                ? <pre key={i} className="overflow-x-auto rounded-lg bg-lightbox p-3 font-mono text-sm ring-1 ring-rule"><code>{b.text}</code></pre>
                : <p key={i}>{b.text}</p>)}
            {read?.low_conf && <p className="text-xs text-strike">Hard to read: notes from this screen are marked uncertain.</p>}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** The diagram's box drawn over the frame; sized from the image's own pixel size once it loads. */
function Outline({ box, src }: { box: [number, number, number, number]; src: string }) {
  const [size, setSize] = useState<[number, number] | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setSize([img.naturalWidth, img.naturalHeight]);
    img.src = src;
  }, [src]);
  if (!size) return null;
  const [x1, y1, x2, y2] = box;
  return (
    <span aria-hidden className="pop absolute rounded-sm ring-2 ring-scan shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]"
      style={{ left: `${(100 * x1) / size[0]}%`, top: `${(100 * y1) / size[1]}%`, width: `${(100 * (x2 - x1)) / size[0]}%`, height: `${(100 * (y2 - y1)) / size[1]}%` }} />
  );
}
