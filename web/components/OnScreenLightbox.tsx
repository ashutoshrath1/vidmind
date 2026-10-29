"use client";

import { useEffect, useRef, useState } from "react";
import SlidesGlyph, { type GlyphName } from "@/components/SlidesGlyph";
import type { Seek } from "@/components/ui";
import { formatTime } from "@/lib/api";
import { screenBlocks } from "@/lib/screen";
import type { FrameView } from "@/lib/trace";

/** One slide full screen, Photos-style: dark backdrop, the frame centred, a glass toolbar, its text below. A native
 * modal dialog traps focus, closes on Esc and hands focus back to the image that opened it; arrow keys step through. */
export default function OnScreenLightbox({ frames, at, go, close, base, seek }: {
  frames: FrameView[]; at: number; go: (i: number) => void; close: () => void; base: string; seek: Seek;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // No close() on cleanup: under StrictMode its close event would shut the box the remount just opened.
    const back = document.activeElement as HTMLElement | null;
    ref.current!.showModal();
    // The frame springs out of the thumbnail that was clicked (a FLIP from its box to the big one).
    const from = back?.getBoundingClientRect(), to = img.current?.getBoundingClientRect();
    if (from?.width && to?.width && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
      const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-spring").trim() || "ease-out";
      img.current!.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` }, { transform: "none" }], { duration: 520, easing });
      ref.current!.animate([{ backgroundColor: "rgb(0 0 0 / 0)" }, {}], { duration: 260, easing: "ease-out" });
    }
    return () => back?.focus();
  }, []);
  const f = frames[at];
  if (!f) return null;
  const step = (d: number) => go((at + d + frames.length) % frames.length);
  const read = f.read;

  return (
    <dialog ref={ref} onClose={close} aria-label={`Screen at ${formatTime(f.at)}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-black p-0 text-white backdrop:bg-black/40">
      <div className="h-full overflow-y-auto overscroll-contain" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-4 pt-6 pb-28 sm:px-8" onClick={(e) => e.target === e.currentTarget && close()}>
          <p className="tabular text-center text-sm text-white/60">Slide {at + 1} of {frames.length}</p>
          <span className="relative mx-auto block w-fit max-w-full overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
            <img ref={img} key={f.url} src={`${base}/${f.url}`} width={1280} height={720} alt={`The screen at ${formatTime(f.at)}`}
              className="block h-auto max-h-[70dvh] w-auto max-w-full" />
            {read?.figure && read.box && <Outline box={read.box} src={`${base}/${f.url}`} />}
          </span>
          <div className="mx-auto w-full max-w-3xl space-y-4 text-[17px] leading-relaxed text-white/90">
            {read?.figure && (
              <figure className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
                <img src={`${base}/${read.figure}`} alt={`The diagram at ${formatTime(f.at)}, enlarged`} className="max-h-[50dvh] w-full rounded-2xl bg-white object-contain" />
                <figcaption className="text-sm text-white/60">The diagram on this screen, enlarged.</figcaption>
              </figure>
            )}
            {!read ? <p className="text-sm text-white/60">Reading this screen…</p>
              : !read.text.trim() ? <p className="text-sm text-white/60">No text on this screen.</p>
              : screenBlocks(read.text).map((b, i) => b.code
                ? <pre key={i} className="overflow-x-auto rounded-xl bg-white/10 p-3 font-mono text-sm"><code>{b.text}</code></pre>
                : <p key={i}>{b.text}</p>)}
            {read?.low_conf && <p className="text-sm text-[#ff6961]">Hard to read: notes from this screen are marked uncertain.</p>}
          </div>
        </div>
      </div>
      <nav aria-label="Slide controls" className="glass fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5 text-ink">
        <Tool name="left" label="Previous screen" onClick={() => step(-1)} />
        <button onClick={() => seek(f.at)} aria-label={`Play from ${formatTime(f.at)}`}
          className="tabular flex h-10 items-center gap-1.5 rounded-full bg-scan px-4 font-mono text-sm font-semibold text-on-scan">
          <SlidesGlyph name="play" className="size-3" />{formatTime(f.at)}
        </button>
        <Tool name="right" label="Next screen" onClick={() => step(1)} />
        <span aria-hidden className="mx-1 h-6 w-px bg-rule" />
        <Tool name="close" label="Close" onClick={close} autoFocus />
      </nav>
    </dialog>
  );
}

function Tool({ name, label, onClick, autoFocus }: { name: GlyphName; label: string; onClick: () => void; autoFocus?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} autoFocus={autoFocus}
      className="grid size-10 place-items-center rounded-full transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]">
      <SlidesGlyph name={name} className="size-5" />
    </button>
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
    <span aria-hidden className="absolute rounded-md ring-2 ring-white shadow-[0_0_0_9999px_rgb(0_0_0/0.4)]"
      style={{ left: `${(100 * x1) / size[0]}%`, top: `${(100 * y1) / size[1]}%`, width: `${(100 * (x2 - x1)) / size[0]}%`, height: `${(100 * (y2 - y1)) / size[1]}%` }} />
  );
}
