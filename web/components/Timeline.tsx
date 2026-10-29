import { formatSeconds, formatTime, modelName } from "@/lib/api";
import SlidesGlyph, { type GlyphName } from "@/components/SlidesGlyph";
import { type Bar, type Rejected, type TraceEvent, type View, lanesOf } from "@/lib/trace";

type Of<K extends TraceEvent["kind"]> = Extract<TraceEvent, { kind: K }>;
const ofKind = <K extends TraceEvent["kind"]>(ev: TraceEvent[], k: K) => ev.filter((e): e is Of<K> => e.kind === k);
const site = (s?: string) => (s && /^youtube$/i.test(s) ? "YouTube" : s);
const CARD = "rounded-[22px] bg-sheet p-5 shadow-[0_1px_3px_rgb(0_0_0/0.05)] sm:p-7";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The numbers that matter, all read from the trace: time to the first note, total time, notes kept and dropped. */
export function runStats(view: View) {
  const ev = view.events;
  const secs = ofKind(ev, "section").filter((e) => e.ok);
  // the checks of the answer that was published (the other model's copy was a spare)
  const used = ofKind(ev, "check").filter((c) => secs.some((s) => s.task === c.task && s.model === c.model));
  const kept = secs.reduce((n, e) => n + e.notes, 0);
  const dropped = secs.reduce((n, e) => n + e.rejected, 0);
  return {
    firstNote: (ev.find((e) => e.kind === "note") ?? secs[0])?.t,
    sections: secs.length,
    kept, dropped,
    proven: kept + dropped ? Math.round((100 * kept) / (kept + dropped)) : undefined,
    fixed: used.filter((c) => c.round === 1).reduce((n, c) => n + c.problems.length, 0),
    rejected: used.flatMap((c) => (c.rejected ?? []).map((r) => ({ ...r, task: c.task }))) as (Rejected & { task: string })[],
    onScreen: ofKind(ev, "stage").find((e) => e.name === "screen" && e.state === "end")?.added ?? 0,
  };
}

/** "How it was made", for a judge with 5 seconds: the headline numbers, the pipeline in four stages with the real
 * numbers and models from the trace, the trust story, then the full chart and log folded under "Run details". */
export default function Timeline({ view, now, running }: { view: View; now: number; running: boolean }) {
  if (!view.events.length)
    return <p className="text-graphite">This result was made before VidMind kept a step-by-step record.</p>;
  const steps = view.events.flatMap((e) => {
    const text = sentence(e);
    return text ? [{ t: e.t, text, tone: tone(e), phase: phaseOf(e) }] : [];
  });
  const total = view.end?.t ?? (running ? now : view.last);
  const s = runStats(view);
  const hero: [string, string, string][] = [
    ...(s.firstNote !== undefined ? [[formatSeconds(s.firstNote), "first note", "First checked note on the page"] as [string, string, string]] : []),
    [formatSeconds(total), running ? "so far" : "all notes", running ? "Time so far" : "Every section written and checked"],
    ...(s.proven !== undefined ? [[`${s.proven}%`, "proven", `${s.kept} of ${s.kept + s.dropped} notes matched the transcript or a keyframe`] as [string, string, string]] : []),
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className={CARD}>
        <h2 className="font-display text-2xl font-semibold tracking-tight">{running ? "Making the notes" : "From video to checked notes"}</h2>
        <dl className="mt-5 grid grid-cols-3 divide-x divide-rule">
          {hero.map(([n, label, long], i) => (
            <div key={label} className={`min-w-0 ${i ? "pl-4 sm:pl-6" : ""} pr-2`}>
              <dt className="sr-only">{long}</dt>
              <dd aria-hidden className="text-[13px] font-semibold text-graphite first-letter:uppercase">{label}</dd>
              <dd className={`tabular mt-1 font-display text-[28px] leading-none font-semibold tracking-tight sm:text-5xl ${label === "proven" ? "text-proof" : ""}`}>{n}</dd>
              <dd aria-hidden className="mt-2 hidden text-[13px] leading-snug text-graphite sm:block">{long}</dd>
            </div>
          ))}
        </dl>
      </header>
      <Pipeline view={view} stats={s} />
      <Trust stats={s} />
      <details className="group overflow-hidden rounded-[20px] bg-sheet shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
        <summary className="hit flex cursor-pointer list-none items-center justify-between px-5 py-3.5 font-medium [&::-webkit-details-marker]:hidden">
          <span>Run details</span>
          <span className="flex items-center gap-1.5 text-[15px] text-graphite"><span className="tabular">{steps.length} events</span>
            <SlidesGlyph name="right" className="size-3.5 transition-transform duration-300 ease-spring group-open:rotate-90 motion-reduce:transition-none" /></span>
        </summary>
        <div className="border-t border-rule p-3 sm:p-4"><RunChart events={view.events} now={now} running={running} /></div>
        <ol aria-label="Every event, in order" className="divide-y divide-rule border-t border-rule text-sm">
          {steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-baseline gap-x-3 px-4 py-2 hover:bg-lightbox sm:grid-cols-[4rem_4.5rem_minmax(0,1fr)]">
              <span className="tabular text-right font-mono text-xs whitespace-nowrap text-graphite">{formatSeconds(s.t)}</span>
              <span className="hidden sm:block"><span className={`inline-block w-full rounded-full py-0.5 text-center text-[11px] font-semibold ${PHASE_TONE[s.phase]}`}>{s.phase}</span></span>
              <span className={`break-words ${s.tone}`}>{s.text}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

type Phase = "Listen" | "Watch" | "Write" | "Check" | "Done";
const PHASE_TONE: Record<Phase, string> = {
  Listen: "bg-lightbox text-cyan", Watch: "bg-lightbox text-pink", Write: "bg-scan-soft text-scan-ink", Check: "bg-proof-soft text-proof", Done: "bg-proof-soft text-proof",
};
const LISTEN = ["fetch", "audio", "transcribe"], WATCH = ["scenes", "frames", "crop", "ocr"];
/** Which of the four stages an event belongs to (the log's tag column). */
function phaseOf(e: TraceEvent): Phase {
  if (e.kind === "source_ready" || e.kind === "source" || e.kind === "plan" || e.kind === "transcript") return "Listen";
  if (e.kind === "stage") return LISTEN.includes(e.name) ? "Listen" : WATCH.includes(e.name) ? "Watch" : "Write";
  if (e.kind === "frame" || e.kind === "keyframes_failed") return "Watch";
  if (e.kind === "check" || e.kind === "section") return "Check";
  if (e.kind === "done" || e.kind === "failed") return "Done";
  return "Write";
}
// The chart's lanes (trace.ts ids) folded into the same four stages.
const PHASE_OF_LANE: Record<string, Phase> = { Source: "Listen", Transcript: "Listen", "Scene changes": "Watch", Keyframes: "Watch", Diagrams: "Watch", "Screen text": "Watch" };

type Card = { name: Phase; icon: GlyphName; line: string; seconds?: number; models: string[]; warn?: string };
const spanOf = (xs: [number, number][]) => (xs.length ? Math.max(...xs.map((x) => x[1])) - Math.min(...xs.map((x) => x[0])) : undefined);
const MUSE_IMAGE_JOBS: Record<string, string> = { article: "the article", images: "its illustrations", slides: "slide explanations", card: "a summary card" };

/** The run as four cards, left to right: Listen, Watch, Write, Check. Every number and model comes from the trace. */
function Pipeline({ view, stats: s }: { view: View; stats: ReturnType<typeof runStats> }) {
  const ev = view.events;
  const stages = ofKind(ev, "stage");
  const stage = (n: string) => stages.filter((e) => e.name === n);
  const ended = (n: string) => stage(n).find((e) => e.state === "end");
  const spans = (es: TraceEvent[]) => es.map((e): [number, number] => [e.kind === "transcript" ? e.t - e.seconds : e.t, e.t]);
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

  const tr = ofKind(ev, "transcript").filter((e) => e.lines.length);
  const subs = view.source?.transcript === "subtitles" || tr.some((e) => /subtitle/.test(e.engine));
  const listen: Card = {
    name: "Listen", icon: "wave",
    line: subs ? "Used the video's own captions: no speech recognition needed"
      : tr.length ? `Transcribed ${view.source ? formatTime(view.source.duration) : "the speech"} in ${plural(tr.length, "part")} at once` : "Listening…",
    seconds: spanOf(spans([...stage("audio"), ...tr])),
    models: subs ? ["Captions"] : uniq(tr.map((e) => e.engine)),
  };

  const cuts = ended("scenes")?.cuts, crop = ended("crop"), ocr = ended("ocr");
  const watched = [cuts !== undefined && plural(cuts, "slide change"), view.frames.length && plural(view.frames.length, "keyframe"),
    ocr && "text read", crop?.cropped && plural(crop.cropped, "diagram") + " cut out"].filter(Boolean);
  const watch: Card = {
    name: "Watch", icon: "eye",
    line: view.keyframesError ? "Couldn't read the frames, so the notes come from speech alone" : watched.length ? watched.join(", ") : "Looking…",
    seconds: spanOf(spans(stages.filter((e) => WATCH.includes(e.name)))),
    models: uniq([crop?.model, ocr?.model]),
  };

  const tries = ofKind(ev, "model");
  const extras = stages.filter((e) => e.state === "end" && MUSE_IMAGE_JOBS[e.name]);
  const vis = ofKind(ev, "visual")[0];
  const wrote = [
    s.sections && `${plural(s.sections, "section")} in parallel`,
    view.overview.result && "title and summary",
    vis && plural(vis.takeaways, "takeaway"),
    s.onScreen && plural(s.onScreen, "on-screen note"),
    ...extras.filter((e) => !e.error).map((e) => MUSE_IMAGE_JOBS[e.name]),
  ].filter(Boolean);
  const failed = extras.filter((e) => e.error);
  const write: Card = {
    name: "Write", icon: "pen",
    line: wrote.length ? wrote.join(", ") : "Writing…",
    seconds: spanOf(spans([...tries, ...ofKind(ev, "section"), ...stages.filter((e) => !LISTEN.includes(e.name) && !WATCH.includes(e.name))])),
    models: uniq([...tries.filter((e) => e.state === "win").map((e) => e.model), ...extras.map((e) => e.model)]),
    warn: failed.length ? failed.map((e) => `${MUSE_IMAGE_JOBS[e.name][0].toUpperCase()}${MUSE_IMAGE_JOBS[e.name].slice(1)} was dropped: ${e.name === "card" ? "its text didn't match" : e.error}`).join(". ") : undefined,
  };

  const checks = ofKind(ev, "check");
  const check: Card = {
    name: "Check", icon: "check",
    line: s.kept + s.dropped ? `${plural(s.kept, "note")} kept, ${s.fixed} ${s.fixed === 1 ? "quote" : "quotes"} fixed, ${s.dropped} dropped` : "Checking…",
    seconds: spanOf(spans(checks)),
    models: checks.length ? ["Exact match, no model"] : [],
  };

  return (
    <section aria-label="Pipeline">
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[listen, watch, write, check].map((c, i) => (
          <li key={c.name} className="relative flex flex-col rounded-[22px] bg-sheet p-5 shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
            {i > 0 && <SlidesGlyph name="right" className="absolute top-1/2 -left-3 z-10 hidden size-3 -translate-y-1/2 text-graphite lg:block" />}
            <div className="flex items-center justify-between">
              <span aria-hidden className={`grid size-9 place-items-center rounded-[10px] ${c.name === "Check" ? "bg-proof text-white dark:text-black" : "bg-scan text-on-scan"}`}><SlidesGlyph name={c.icon} className="size-5" /></span>
              {c.seconds !== undefined && <span className="tabular text-[15px] font-semibold">{formatSeconds(c.seconds)}</span>}
            </div>
            <h3 className="mt-3 font-display text-xl font-semibold tracking-tight"><span className="tabular mr-1.5 text-graphite">{i + 1}</span>{c.name}</h3>
            <p className="mt-1 flex-1 text-[15px] leading-snug text-graphite first-letter:uppercase">{c.line}</p>
            {c.warn && <p className="mt-2 text-[13px] leading-snug text-wait">{c.warn}</p>}
            {c.models.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {c.models.map((m) => <li key={m} title={m} className="rounded-full bg-lightbox px-2.5 py-1 text-[12px] font-semibold">{m.includes(" ") ? m : pretty(m)}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** "muse-voice-transcribe-1.0" → "Muse Voice Transcribe 1.0"; short words are acronyms ("sam-3.1" → "SAM 3.1"). */
export const pretty = (id: string) => modelName(id).split("-").map((w) => (/^\d/.test(w) ? w : w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");

/** The trust story: every note was checked before it reached the page; anything unsupported was thrown out, with why. */
function Trust({ stats: s }: { stats: ReturnType<typeof runStats> }) {
  if (!s.kept && !s.dropped) return null;
  return (
    <section aria-labelledby="how-trust" className={CARD}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-proof-soft text-proof"><SlidesGlyph name="check" className="size-5" /></span>
        <div>
          <h3 id="how-trust" className="font-display text-xl font-semibold tracking-tight">Every note was checked before you saw it</h3>
          <p className="mt-1 text-[15px] leading-relaxed text-graphite">
            A note reaches the page only if its quote is in the transcript within a few seconds of where it says, and any
            frame it cites is a real keyframe. Nearly right quotes are fixed to the exact words; the rest are dropped.
          </p>
        </div>
      </div>
      <ul className="mt-5 grid grid-cols-3 divide-x divide-rule rounded-[18px] bg-lightbox py-4 text-center">
        {([["kept", s.kept, "text-proof"], ["snapped", s.fixed, "text-ink"], ["dropped", s.dropped, s.dropped ? "text-strike" : "text-ink"]] as const).map(([k, n, c]) => (
          <li key={k} className="px-2">
            <span className={`tabular block font-display text-3xl font-semibold tracking-tight ${c}`}>{n}</span>
            <span className="text-[13px] text-graphite">{k === "snapped" ? "quotes fixed" : `notes ${k}`}</span>
          </li>
        ))}
      </ul>
      {s.rejected.length > 0 ? (
        <>
          <h4 className="mt-6 px-1 pb-1.5 text-[13px] font-medium text-graphite">Dropped, and why</h4>
          <ul className="overflow-hidden rounded-[18px] bg-lightbox">
            {s.rejected.map((r, i) => (
              <li key={i} className="flex gap-3 border-b border-rule px-4 py-3 text-[15px] last:border-b-0">
                <SlidesGlyph name="clear" className="mt-0.5 size-[18px] shrink-0 text-strike" />
                <div className="min-w-0">
                  <p className="break-words text-graphite line-through decoration-strike/50">{r.text}</p>
                  <p className="mt-0.5 text-[13px] text-strike">{task(r.task)[0].toUpperCase() + task(r.task).slice(1)}: {r.reasons.join("; ")}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-[15px] text-proof">Nothing was dropped this time: every quote and frame matched.</p>
      )}
    </section>
  );
}

const BAR: Record<Bar["state"], string> = {
  running: "animate-pulse bg-scan text-on-scan motion-reduce:animate-none",
  done: "bg-scan text-on-scan",
  won: "bg-scan text-on-scan",
  lost: "bg-graphite/15 text-graphite",
  failed: "bg-strike text-white",
};
const OUTCOME: Record<Bar["state"], string> = { running: "working now", done: "used", won: "used in the notes", lost: "spare copy, finished but not needed", failed: "failed" };
const LEGEND = [["won", "used"], ["lost", "spare copy"], ["failed", "failed"]] as const;

const barLabel = (b: Bar) => (b.model ? `${b.label.replace("section ", "§")} · ${pretty(b.model)}` : b.label);

/** Overlapping bars in a lane go on separate rows, so no attempt hides another. */
function rows(bars: Bar[]): Bar[][] {
  const out: Bar[][] = [];
  for (const b of [...bars].sort((x, y) => x.start - y.start)) {
    const row = out.find((r) => r[r.length - 1].end <= b.start + 0.05);
    if (row) row.push(b);
    else out.push([b]);
  }
  return out;
}

/** One fixed-height row per step on a shared time axis. Overlapping attempts split the row into thinner bars, so
 * rows stay aligned; every bar opens a magnifier card on hover or focus. Grows live and in a replay. */
export function RunChart({ events, now, running }: { events: View["events"]; now: number; running: boolean }) {
  const grouped = new Map<Phase, Bar[]>();
  for (const l of lanesOf(events, now)) {
    const p = PHASE_OF_LANE[l.name] ?? "Write";
    grouped.set(p, [...(grouped.get(p) ?? []), ...l.bars]);
  }
  const checks = ofKind(events, "check").map((c): Bar => ({ start: c.t - 0.2, end: c.t, label: `check ${task(c.task)}`, state: "done",
    detail: c.problems.length ? `${plural(c.problems.length, "citation")} didn't match` : `all ${c.notes} notes matched` }));
  if (checks.length) grouped.set("Check", checks);
  const lanes = (["Listen", "Watch", "Write", "Check"] as const).filter((p) => grouped.has(p)).map((name) => ({ name, bars: grouped.get(name)! }));
  const end = Math.max(now, ...lanes.flatMap((l) => l.bars.map((b) => b.end)), 0.1);
  const step = [1, 2, 5, 10, 15, 30, 60].find((n) => end / n <= 6) ?? 120;
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
  const x = (t: number) => `${(100 * t) / end}%`;
  return (
    <section aria-label="The run, step by step" className={CARD}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Second by second <span className="tabular font-normal text-graphite">{formatSeconds(end)}</span></h3>
        <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-graphite">
          {LEGEND.map(([k, label]) => (
            <li key={k} className="flex items-center gap-1.5"><span aria-hidden className={`h-2.5 w-4 rounded-full ${BAR[k].replace("animate-pulse ", "")}`} />{label}</li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-[4rem_1fr] sm:grid-cols-[5rem_1fr]">
        <span />
        <div className="tabular relative h-5 text-[11px] text-graphite">
          {ticks.map((t) => <span key={t} className="absolute top-0 -translate-x-1/2 first:translate-x-0" style={{ left: x(t) }}>{t}s</span>)}
        </div>
        {lanes.map((lane) => {
          const laneRows = rows(lane.bars);
          const ROW = Math.max(34, laneRows.length * 7 + 8); // a busy stage grows taller instead of squashing its bars
          const h = (ROW - 8) / laneRows.length;
          return (
            <div key={lane.name} className="contents">
              <span className="flex items-center gap-2 border-t border-rule pr-2 text-[12px] leading-tight font-medium sm:text-[13px]" style={{ height: ROW }}>
                <span>{lane.name}</span>
              </span>
              <div className="relative border-t border-rule" style={{ height: ROW }}>
                {ticks.map((t) => <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-rule" style={{ left: x(t) }} />)}
                {laneRows.map((row, ri) => row.map((b, i) => (
                  <Lens key={`${ri}-${i}`} className="absolute" style={{ top: 4 + ri * h, height: Math.max(3, h - 2), left: x(b.start), width: `max(6px, ${x(b.end - b.start)})` }}
                    title={barLabel(b)}
                    lines={[`${formatSeconds(b.start)} to ${formatSeconds(b.end)}, ${formatSeconds(b.end - b.start)}`, OUTCOME[b.state], ...(b.detail ? [b.detail] : [])]}>
                    <span className={`flex h-full origin-left items-center overflow-hidden rounded-full px-2 text-[11px] font-semibold whitespace-nowrap transition-[scale] duration-700 ease-spring starting:scale-x-0 motion-reduce:transition-none ${BAR[b.state]}`}>
                      {laneRows.length === 1 && (b.end - b.start) / end >= 0.2 && barLabel(b)}
                    </span>
                  </Lens>
                )))}
                {running && <span aria-hidden className="absolute inset-y-0 w-px bg-scan" style={{ left: x(now) }} />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A focusable target that shows a small details card on hover and keyboard focus. */
export function Lens({ title, lines, children, className = "", style, below = false }: { title: string; lines: string[]; children: React.ReactNode; className?: string; style?: React.CSSProperties; below?: boolean }) {
  return (
    <span tabIndex={0} aria-label={`${title}. ${lines.join(". ")}`} style={style}
      className={`group/lens outline-none hover:z-30 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-scan ${className}`}>
      {children}
      <span role="tooltip" className={`pointer-events-none absolute left-1/2 z-40 hidden w-max max-w-72 -translate-x-1/2 group-hover/lens:block group-focus-visible/lens:block ${below ? "top-full mt-2" : "bottom-full mb-2"}`}>
        <span className="pop relative block rounded-[14px] bg-sheet px-3.5 py-2.5 text-left text-[13px] leading-relaxed text-ink shadow-[0_8px_30px_rgb(0_0_0/0.16)] ring-1 ring-rule">
          <span className="block font-semibold">{title}</span>
          {lines.map((l, i) => <span key={i} className="block text-graphite">{l}</span>)}
        </span>
      </span>
    </span>
  );
}

function tone(e: TraceEvent) {
  if (e.kind === "failed" || (e.kind === "model" && e.state === "fail")) return "text-strike";
  if (e.kind === "done" || (e.kind === "model" && e.state === "win") || e.kind === "section") return "text-proof";
  return "";
}

const OTHER: Record<string, string> = { overview: "the title and summary", test: "the test scenarios", meet: "the actions", visual: "the takeaways and diagram" };
const task = (t: string) => OTHER[t] ?? `section ${Number(t.slice(1)) + 1}`;
const Task = (t: string) => task(t)[0].toUpperCase() + task(t).slice(1); // at the start of a sentence

export function sentence(e: TraceEvent): string | null {
  switch (e.kind) {
    case "source_ready":
      return e.origin === "upload"
        ? `Received the upload, ${e.size_mb} MB, ${formatTime(e.duration ?? 0)} long`
        : `Found “${e.title}” on ${site(e.site)} in ${formatSeconds(e.seconds ?? 0)}: ${formatTime(e.duration ?? 0)} long, ${e.subtitles ? "with creator subtitles" : "no subtitles"}${e.streaming ? ", will stream it" : ""}`;
    case "stage":
      if (e.state === "start") return e.detail ?? null;
      return {
        fetch: `Video ready in ${formatSeconds(e.seconds ?? 0)}`,
        audio: `Audio in memory after ${formatSeconds(e.seconds ?? 0)}`,
        scenes: `Found ${e.cuts} scene changes in ${formatSeconds(e.seconds ?? 0)}`,
        frames: `Keyframes captured in ${formatSeconds(e.seconds ?? 0)}`,
        screen: `Added ${e.added ?? 0} checked on-screen notes from the keyframes`,
        ocr: `All screen text read in ${formatSeconds(e.seconds ?? 0)}`,
      }[e.name] ?? null;
    case "source":
      return `Transcript from ${e.transcript === "subtitles" ? `${e.caption_lines} subtitle lines` : e.transcript === "speech" ? "speech recognition" : "nowhere: no audio"}. Notes models, in order: ${e.models.map(modelName).join(", ")}`;
    case "plan":
      return `Split into ${e.sections.length} sections: ${e.sections.map(([a, b]) => `${formatTime(a)} to ${formatTime(b)}`).join(", ")}`;
    case "transcript":
      return `${Task(e.task)}: ${e.lines.length} lines from ${e.engine}${e.seconds ? ` in ${formatSeconds(e.seconds)}` : ""}`;
    case "frame":
      return `Keyframe at ${formatTime(e.at)}: ${e.text ? `“${e.text.replace(/\n/g, " ").slice(0, 90)}${e.text.length > 90 ? "…" : ""}”` : "no text"} (${formatSeconds(e.seconds)})`;
    case "model":
      return {
        start: `${modelName(e.model)} started on ${task(e.task)}${e.reason === "hedge" ? ", as a spare copy at the same time" : e.reason === "fallback" ? ", after a failure" : ""}`,
        end: `${modelName(e.model)} answered ${task(e.task)} in ${formatSeconds(e.seconds ?? 0)}`,
        fail: `${modelName(e.model)} failed on ${task(e.task)} after ${formatSeconds(e.seconds ?? 0)}: ${e.error ?? ""}`,
        win: `${modelName(e.model)} won ${task(e.task)}`,
      }[e.state];
    case "check":
      return `${e.round === 1 ? "Checked" : "Re-checked"} ${task(e.task)} from ${modelName(e.model)}: ${e.problems.length ? `${e.problems.length} citations didn't match` : `all ${e.notes} notes matched`}`;
    case "section":
      return e.ok ? `${Task(e.task)} published: “${e.title}”, ${e.notes} notes` : `${Task(e.task)} failed on every model`;
    case "note":
      return `${Task(e.task)}: a note written and checked, “${e.note.text.slice(0, 60)}${e.note.text.length > 60 ? "…" : ""}”`;
    case "overview":
      return `Title: “${e.title}”`;
    case "visual":
      return `${e.takeaways} takeaways${e.diagram ? ` and a${/^[aeiou]/.test(e.diagram) ? "n" : ""} ${e.diagram} diagram` : ""} ready`;
    case "extras":
      return e.card ? "Summary card ready, its text checked" : null;
    case "clip": // older runs only

      return `${Task(e.task)}: cut ${formatTime(e.at[0])}-${formatTime(e.at[1])} as a ${e.kb} KB video clip`;
    case "watch": // older runs only
      return `${modelName(e.model)} is watching ${formatTime(e.seconds)} of video for ${task(e.task)}`;
    case "keyframes_failed":
      return `Couldn't read the video frames (${e.error}); notes come from the transcript alone`;
    case "done":
      return "Done";
    case "failed":
      return `Stopped: ${e.error}`;
  }
}
