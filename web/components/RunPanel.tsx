"use client";

import { Lens, sentence } from "@/components/Timeline";
import { useState } from "react";
import { Button, Counter } from "@/components/ui";
import { formatSeconds, formatTime, modelName } from "@/lib/api";
import { type View, secondsLeft } from "@/lib/trace";

type State = "waiting" | "working" | "done" | "skipped";
type Step = { name: string; state: State; detail: string; progress?: [number, number]; fact?: string };

type Props = {
  view: View;
  now: number;
  running: boolean; // live or replaying
  replaying: boolean;
  celebrate: boolean; // we watched it finish (live or replay), so the finish gets its moment
  onReplay?: () => void;
};

/** The run, front and centre: what is happening right now in one line, and every step with its count and time. */
export default function RunPanel({ view, now, running, replaying, celebrate, onReplay }: Props) {
  const steps = describe(view, now);
  const left = running ? secondsLeft(view, now) : undefined;
  const lastIndex = view.events.findLastIndex((e) => sentence(e));
  const latest = lastIndex >= 0 ? sentence(view.events[lastIndex]) : null;
  const end = view.end;

  return (
    <section aria-label="How your video is being processed" className="rounded-lg bg-sheet px-4 py-3 ring-1 ring-rule sm:px-5">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          {end && !running ? <Finish view={view} celebrate={celebrate} small /> : (
            <p key={lastIndex} title={latest ?? undefined} className="narrate truncate font-display text-base font-semibold" aria-live="off">
              <span className="mr-2 text-sm font-normal text-scan-ink">{replaying ? "Replay" : "Now"}</span>
              {latest ?? "Opening the video"}
            </p>
          )}
        </div>
        <p className="tabular shrink-0 font-display text-lg leading-none font-bold" title={running ? "so far" : "total"}>
          {formatSeconds(end && !running ? end.t : now)}
        </p>
        {end && !running && onReplay && (
          <Button variant="quiet" onClick={onReplay} className="!min-h-9 !px-3 text-sm">↻ Replay</Button>
        )}
      </div>
      <Track steps={steps} now={now} left={left} running={running} done={!!end} />
      {/* One announcement for screen readers when the run ends; the narration line changes too fast to read out. */}
      <p className="sr-only" aria-live="polite">
        {end ? (end.ok ? `Finished in ${formatSeconds(end.t)}` : `Stopped: ${end.error}`) : ""}
      </p>
    </section>
  );
}

/** The climax: the rarest event gets the biggest moment, a stamp, ticks bursting out and the verified share counting up. */
function Finish({ view, celebrate, small = false }: { view: View; celebrate: boolean; small?: boolean }) {
  const done = view.sections.filter((s) => s.done?.ok);
  const kept = done.reduce((n, s) => n + s.done!.notes, 0);
  const removed = view.sections.reduce((n, s) => n + (s.done?.rejected ?? 0), 0);
  if (!view.end?.ok) return <p className="mt-1 font-display text-xl font-semibold text-strike">{view.end?.error}</p>;
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${small ? "" : "mt-1"}`}>
      <span className="relative">
        <span className={`${celebrate ? "stamp" : ""} inline-block rotate-[-3deg] rounded-md border-2 border-proof px-3 py-0.5 font-display font-bold text-proof ${small ? "text-base" : "text-xl"}`}>
          Checked
        </span>
        {celebrate &&
          Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            return (
              <span
                key={i}
                aria-hidden
                className="burst absolute top-1/2 left-1/2 -mt-1.5 -ml-1.5 text-xs text-proof"
                style={{ "--dx": `${Math.cos(a) * 70}px`, "--dy": `${Math.sin(a) * 40}px`, animationDelay: "200ms" } as React.CSSProperties}
              >
                ✓
              </span>
            );
          })}
      </span>
      <p className={`font-display leading-snug font-semibold ${small ? "text-base" : "text-xl"}`}>
        {done.length} section{done.length === 1 ? "" : "s"} written,{" "}
        <Counter value={kept} /> notes verified
        {removed > 0 && (
          <>
            , <span className="text-strike"><Counter value={removed} /> removed</span>
          </>
        )}
      </p>
    </div>
  );
}

/** The steps as one broad segmented bar: a segment per step, green when done and pulsing while working, its
 * name and number underneath, a fact card on hover. A comet of spectrum light rides it, never backwards. */
function Track({ steps, now, left, running, done }: { steps: Step[]; now: number; left?: number; running: boolean; done: boolean }) {
  const raw = done && !running ? 100 : Math.min(96, 100 * (left === undefined ? now / (now + 30) : now / Math.max(0.1, now + left)));
  const [pct, setPct] = useState(0);
  if (raw > pct || (now < 0.05 && pct !== raw)) setPct(raw); // adjusted during render: forward only; a replay (now ~ 0) restarts it
  const label = done && !running ? "Finished" : left === undefined ? "Estimating the time left" : `About ${formatSeconds(left)} left`;
  const tone = { done: "bg-proof", working: "scanning bg-scan", waiting: "bg-rule", skipped: "bg-graphite/30" } as const;
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className="relative mt-3 overflow-x-clip">
      <span aria-hidden className={`comet ${running ? "comet-run" : done ? "comet-done" : ""}`}
        style={{ left: `${pct}%`, transitionDuration: pct < 1 ? "0ms" : undefined }} />
      {done && !running && <span aria-hidden key="sweep" className="track-sweep" />}
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => (
          <li key={s.name} aria-current={s.state === "working" ? "step" : undefined}>
            <Lens title={s.name} lines={[s.fact ?? s.detail]} below className="relative block rounded px-0.5 pb-0.5 transition hover:bg-lightbox">
              <span className={`block h-1.5 rounded-full transition-colors ${tone[s.state]}`} />
              <span className="mt-1 flex items-baseline gap-1 text-[11px] leading-tight">
                <span className={`truncate font-semibold sm:shrink-0 ${s.state === "waiting" ? "text-graphite" : ""}`}>{s.name}</span>
                <span className="tabular hidden truncate text-graphite sm:inline">{s.detail}</span>
              </span>
            </Lens>
          </li>
        ))}
      </ol>
    </div>
  );
}

const secs = (s?: number) => (s === undefined ? "" : formatSeconds(s));

/** Each pipeline step's state, what it found and how long it took, from the trace alone (so replay works too). */
export function describe(v: View, now: number): Step[] {
  const ready = v.ready;
  const fetch = v.stages.fetch;
  const ended = !!v.end;

  const source: Step = !ready
    ? { name: "Source", state: "working", detail: "Opening the video" }
    : fetch && !fetch.end && !v.source && !ended
      ? { name: "Source", state: "working", detail: fetch.detail ?? "Fetching" }
      : {
          name: "Source",
          state: "done",
          detail:
            ready.origin === "upload"
              ? `${ready.size_mb} MB uploaded`
              : v.source?.streaming
                ? "Streamed, nothing downloaded"
                : `Downloaded in ${secs(fetch?.seconds)}`,
        };

  const total = v.sections.length;
  const heard = v.sections.filter((s) => s.lines).length;
  const transcript: Step =
    v.source?.transcript === "subtitles"
      ? { name: "Transcript", state: "done", detail: `${v.source.caption_lines} subtitle lines` }
      : v.source?.transcript === "none"
        ? { name: "Transcript", state: "skipped", detail: "No audio track" }
        : !v.source
          ? { name: "Transcript", state: "waiting", detail: "Subtitles or speech" }
          : heard < total || !total
            ? {
                name: "Transcript",
                state: "working",
                detail: v.stages.audio && !v.stages.audio.end ? "Pulling the audio track" : `Listening, section ${heard + 1} of ${total}`,
                progress: [heard, total],
              }
            : {
                name: "Transcript",
                state: "done",
                detail: `${v.sections.reduce((n, s) => n + (s.lines?.length ?? 0), 0)} sentences in ${secs(v.sections.reduce((n, s) => n + (s.transcribeSeconds ?? 0), 0))}`,
                progress: [total, total],
              };

  const sc = v.stages.scenes;
  const scenes: Step = !sc
    ? { name: "Scene changes", state: "waiting", detail: "Every frame, low resolution" }
    : !sc.end
      ? { name: "Scene changes", state: "working", detail: `Scanning, ${secs(now - sc.start!)}` }
      : { name: "Scene changes", state: "done", detail: `${v.cuts ?? 0} found in ${secs(sc.seconds)}` };

  const fr = v.stages.frames;
  const keyframes: Step = !fr
    ? { name: "Keyframes", state: "waiting", detail: "One per scene, up to 12" }
    : !fr.end
      ? { name: "Keyframes", state: "working", detail: fr.detail ?? "Capturing" }
      : { name: "Keyframes", state: "done", detail: `${v.frames.length} captured in ${secs(fr.seconds)}` };

  const ocr = v.stages.ocr;
  const read = v.frames.filter((f) => f.read);
  const screen: Step = !ocr
    ? { name: "Screen text", state: "waiting", detail: "OCR on each keyframe" }
    : !ocr.end
      ? { name: "Screen text", state: "working", detail: `Reading frame ${Math.min(read.length + 1, v.frames.length)} of ${v.frames.length}`, progress: [read.length, v.frames.length] }
      : { name: "Screen text", state: "done", detail: `${read.filter((f) => f.read!.text).length} of ${v.frames.length} had text, ${secs(ocr.seconds)}`, progress: [read.length, v.frames.length] };

  const written = v.sections.filter((s) => s.done).length;
  const starts = v.sections.flatMap((s) => s.attempts.map((a) => a.start));
  const racing = v.sections.reduce((n, s) => n + s.attempts.filter((a) => a.state === "running").length, 0);
  const notes: Step = !starts.length
    ? { name: "Notes", state: written || ended ? "done" : "waiting", detail: total ? `${total} sections planned` : "Model race per section", progress: total ? [written, total] : undefined }
    : written < total && !ended
      ? { name: "Notes", state: "working", detail: `${written} of ${total} sections, ${racing} model${racing === 1 ? "" : "s"} writing`, progress: [written, total] }
      : {
          name: "Notes",
          state: "done",
          detail: `${total} section${total === 1 ? "" : "s"} in ${secs(Math.max(...v.sections.map((s) => s.done?.t ?? 0)) - Math.min(...starts))}`,
          progress: [written, total],
        };

  const firstRound = v.sections.flatMap((s) => s.checks.filter((c) => c.round === 1));
  const sentBack = firstRound.reduce((n, c) => n + c.problems.length, 0);
  const removed = v.sections.reduce((n, s) => n + (s.done?.rejected ?? 0), 0);
  const check: Step = !firstRound.length
    ? { name: "Evidence check", state: ended ? "done" : "waiting", detail: "Every quote and frame" }
    : notes.state === "working"
      ? { name: "Evidence check", state: "working", detail: `${sentBack} citation${sentBack === 1 ? "" : "s"} caught so far` }
      : { name: "Evidence check", state: "done", detail: `${sentBack} fixed, ${removed} removed` };

  // The fact behind each box, for its hover card: what was used and what came out, from the run log.
  const ended_ = (name: string) => v.events.findLast((e) => e.kind === "stage" && e.name === name && e.state === "end");
  const engines = [...new Set(v.sections.map((x) => x.engine).filter(Boolean))].join(", ");
  const writers = [...new Set(v.sections.map((x) => x.done?.model).filter((m) => m && m !== "failed"))].map((m) => modelName(m!)).join(", ");
  const watched = v.events.reduce((n, e) => n + (e.kind === "watch" && e.task.startsWith("s") ? e.seconds : 0), 0);
  const crop = ended_("crop");
  const ocrEnd = ended_("ocr");
  source.fact = ready?.origin === "upload" ? `Your ${ready.size_mb} MB file, ${formatTime(ready.duration ?? 0)} long, kept on this server for 24 hours`
    : ready ? `“${ready.title}” on ${ready.site}, ${formatTime(ready.duration ?? 0)} long. ${v.source?.streaming ? "Streamed: nothing was downloaded" : "Downloaded at up to 720p"}` : undefined;
  transcript.fact = v.source?.transcript === "subtitles" ? `Used the creator's own subtitles, so no speech recognition was needed`
    : engines ? `${engines} turned ${formatTime(v.sections.reduce((n, x) => n + x.hi - x.lo, 0))} of speech into ${v.sections.reduce((n, x) => n + (x.lines?.length ?? 0), 0)} timed sentences, ${total} parts at once` : undefined;
  scenes.fact = sc?.end ? `Compared every frame at low resolution; ${v.cuts ?? 0} moments where the picture changed` : undefined;
  keyframes.fact = fr?.end ? `${v.frames.length} frames grabbed about a second after each change${crop?.kind === "stage" && crop.model ? `; ${modelName(crop.model)} looked for a screen in each and cropped ${crop.cropped ?? 0}` : ""}` : undefined;
  screen.fact = ocr?.end ? `${(ocrEnd?.kind === "stage" && ocrEnd.model) || "OCR"} read ${read.filter((f) => f.read!.text).reduce((n, f) => n + f.read!.text.split(/\s+/).length, 0)} words off the screen` : undefined;
  notes.fact = writers ? `${writers} wrote ${written} section${written === 1 ? "" : "s"}${watched ? `, watching ${formatTime(watched)} of the video itself` : ""}` : undefined;
  check.fact = firstRound.length ? `Every quote matched to the transcript, every frame to a keyframe: ${sentBack} fixed, ${removed} thrown out` : undefined;

  if (v.keyframesError) {
    const skip = (name: string): Step => ({ name, state: "skipped", detail: "Frames unreadable; notes use the transcript" });
    return [source, transcript, skip("Scene changes"), skip("Keyframes"), skip("Screen text"), notes, check];
  }
  return [source, transcript, scenes, keyframes, screen, notes, check];
}
