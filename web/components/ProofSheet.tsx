"use client";

import { useEffect, useState } from "react";
import { Button, Chip, EvidenceChip, type Seek, TimeButton } from "@/components/ui";
import { type Answer, formatSeconds, formatTime } from "@/lib/api";
import type { View } from "@/lib/trace";

/** The keyframes as a contact sheet. Each frame shows the scan line while OCR reads it, then what it found. */
export default function ProofSheet({ view, base, seek }: { view: View; base: string; seek: Seek }) {
  const [open, setOpen] = useState<number | null>(null);
  if ((!view.frames.length && !view.stages.scenes) || view.keyframesError) return null;
  const reading = !!view.stages.ocr && !view.stages.ocr.end;
  const picked = open !== null ? view.frames[open] : undefined;
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  // The frame read most recently, so the extracted text is shown as it comes out, not hidden behind a click.
  const latest = view.frames.filter((f) => f.read).sort((a, b) => b.read!.t - a.read!.t)[0];

  return (
    <section aria-label="Keyframes" className="rounded-lg bg-sheet ring-1 ring-rule">
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display font-semibold">Keyframes</h2>
          <p className="tabular text-xs text-graphite">
            {!view.frames.length
              ? "Finding scene changes"
              : reading
                ? `Reading screen text, ${view.frames.filter((f) => f.read).length} of ${view.frames.length}`
                : "Tap a frame for its text"}
          </p>
        </div>
        <ul className="grid grid-cols-4 gap-1.5">
          {(view.frames.length ? view.frames : Array.from({ length: 8 }, () => null)).map((f, i) =>
            f ? (
              <li key={f.url}>
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  aria-pressed={open === i}
                  aria-label={`Keyframe at ${formatTime(f.at)}${f.read ? `, ${f.read.text ? `${words(f.read.text)} words read` : "no text"}` : ", being read"}`}
                  className={`relative block w-full overflow-hidden rounded bg-ink ring-2 transition ${open === i ? "ring-scan" : "ring-transparent hover:ring-graphite"} ${f.read ? (reading ? "flash" : "") : "scanning"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
                  <img src={`${base}/${f.url}`} alt="" className="arrive aspect-video w-full object-cover" />
                  <span className="tabular absolute bottom-0.5 left-0.5 rounded-sm bg-black/70 px-1 text-[10px] text-white">{formatTime(f.at)}</span>
                  {f.read?.figure && <span className="absolute top-0.5 right-0.5 rounded-sm bg-scan px-1 text-[10px] font-semibold text-on-scan" title="Diagram found">◱</span>}
                  {f.read && f.read.text && (
                    <span className="tabular absolute right-0.5 bottom-0.5 rounded-sm bg-marker px-1 text-[10px] text-[#142036]">{words(f.read.text)}w</span>
                  )}
                </button>
              </li>
            ) : (
              <li key={i} className="scanning aspect-video rounded bg-lightbox" aria-hidden />
            ),
          )}
        </ul>
        {reading && latest && (
          <p key={latest.i} className="narrate rounded-lg bg-lightbox p-3 text-sm" aria-live="off">
            <span className="tabular mr-2 font-display font-semibold text-scan-ink">Read at {formatTime(latest.at)}</span>
            {latest.read!.text ? <span className="marker font-mono">{latest.read!.text.replace(/\n/g, " · ").slice(0, 160)}</span> : <span className="text-graphite">no text on this frame</span>}
          </p>
        )}
        {picked && (
          <div className="arrive space-y-2 rounded-lg bg-lightbox p-3">
            <div className="flex flex-wrap items-center gap-2">
              <TimeButton t={picked.at} seek={seek} label={`Play ${formatTime(picked.at)}`} />
              {picked.read ? (
                <>
                  <Chip tone={picked.read.low_conf ? "strike" : "proof"}>
                    {picked.read.text ? `${picked.read.conf}% confident` : "No text on screen"}
                  </Chip>
                  <Chip>read in {formatSeconds(picked.read.seconds)}</Chip>
                  {picked.read.low_conf && <Chip tone="strike">Hard to read: notes from it are marked uncertain</Chip>}
                </>
              ) : (
                <Chip tone="scan">Reading</Chip>
              )}
            </div>
            <PointAsk key={picked.url} base={base} url={picked.url} at={picked.at} seek={seek} />
            {picked.read?.figure && picked.read.box && (
              <figure className="grid gap-2 sm:grid-cols-2">
                <span className="relative block overflow-hidden rounded">
                  {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
                  <img src={`${base}/${picked.url}`} alt="" className="w-full" />
                  <Outline box={picked.read.box} src={`${base}/${picked.url}`} />
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
                <img src={`${base}/${picked.read.figure}`} alt={`The diagram at ${formatTime(picked.at)}, enlarged`} className="w-full rounded bg-white object-contain ring-1 ring-rule" />
                <figcaption className="text-xs text-graphite sm:col-span-2">
                  Diagram found by segmentation, sent enlarged to the notes model.
                </figcaption>
              </figure>
            )}
            {picked.read?.text && <p className="max-h-48 overflow-y-auto font-mono text-sm leading-relaxed whitespace-pre-line">{picked.read.text}</p>}
          </div>
        )}
      </div>
    </section>
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

/** Point and ask: click anything on the frame. The segmentation model outlines what was clicked, and the notes model
 * explains it from the frame, a close-up and what was said around then, checked like any answer. */
function PointAsk({ base, url, at, seek }: { base: string; url: string; at: number; seek: Seek }) {
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [question, setQuestion] = useState("What is this?");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!spot) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`${base}/point`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame_url: url, x: spot.x, y: spot.y, question }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) setAnswer(await res.json());
    else setError("Couldn't answer that. Try another spot.");
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-graphite">👆 Click anything on the frame to ask about it.</p>
      <button type="button" aria-label={`Frame at ${formatTime(at)}: click a spot to ask about it`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setSpot({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
          setAnswer(null);
        }}
        className={`relative block w-full cursor-crosshair overflow-hidden rounded ring-1 ring-rule ${busy ? "scanning" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
        <img src={`${base}/${url}`} alt="" className="w-full" />
        {answer?.box && <Outline box={answer.box as [number, number, number, number]} src={`${base}/${url}`} />}
        {spot && !answer && (
          <span aria-hidden className="pop absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-scan shadow-[0_0_0_4px_rgb(139_123_255/0.35)]"
            style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }} />
        )}
      </button>
      {spot && (
        <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="flex gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} aria-label="Your question about the spot"
            className="min-h-11 min-w-0 flex-1 rounded-full bg-sheet px-4 text-sm ring-1 ring-rule focus:ring-scan focus:outline-none" />
          <Button type="submit" disabled={busy || question.trim().length < 2} working={busy}>Ask</Button>
        </form>
      )}
      {error && <p className="text-sm text-strike">{error}</p>}
      {answer && (
        <div className="arrive space-y-2 rounded-lg bg-sheet p-3 ring-1 ring-rule">
          <p className="leading-relaxed">{answer.answer}</p>
          <p className="flex flex-wrap items-center gap-1.5">
            {answer.found ? <Chip tone="proof">Checked against the video</Chip> : <Chip>Not in this video</Chip>}
            {answer.evidence.map((e, i) => <EvidenceChip key={i} evidence={e} base={base} seek={seek} />)}
          </p>
        </div>
      )}
    </div>
  );
}
