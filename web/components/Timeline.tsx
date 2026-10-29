import { formatSeconds, formatTime, modelName } from "@/lib/api";
import SlidesGlyph, { type GlyphName } from "@/components/SlidesGlyph";
import { type Bar, type Rejected, type TraceEvent, type View, lanesOf, modelsUsed } from "@/lib/trace";

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

/** "How it was made": the headline numbers, the trust story (what was checked and what was thrown out), the steps in
 * plain words with their measured seconds, then the lane chart and the full log for people who want every detail. */
export default function Timeline({ view, now, running }: { view: View; now: number; running: boolean }) {
  if (!view.events.length)
    return <p className="text-graphite">This result was made before VidMind kept a step-by-step record.</p>;
  const steps = view.events.flatMap((e) => {
    const text = sentence(e);
    return text ? [{ t: e.t, text, tone: tone(e), lane: laneOf(e) }] : [];
  });
  const total = view.end?.t ?? (running ? now : view.last);
  const s = runStats(view);
  const used = modelsUsed(view.events).filter((m) => m.did.length);
  const hero: [string, string, string][] = [
    ...(s.firstNote !== undefined ? [[formatSeconds(s.firstNote), "first note", "First checked note on the page"] as [string, string, string]] : []),
    [formatSeconds(total), running ? "so far" : "all notes", running ? "Time so far" : "Every section written and checked"],
    ...(s.proven !== undefined ? [[`${s.proven}%`, "proven", `${s.kept} of ${s.kept + s.dropped} notes matched the transcript or a keyframe`] as [string, string, string]] : []),
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-8">
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
        <p className="mt-6 border-t border-rule pt-4 text-[15px] leading-relaxed text-graphite">
          {view.source && <>{formatTime(view.source.duration)} of video, </>}
          {plural(s.sections, "section")} written in parallel, {plural(s.kept, "note")} kept{s.dropped > 0 && <>, <span className="text-strike">{s.dropped} dropped</span></>}
          {s.fixed > 0 && <>, {plural(s.fixed, "quote")} snapped to the exact words</>}
          {s.onScreen > 0 && <>, then {plural(s.onScreen, "on-screen note")} from the keyframes</>}.
          {view.last > total + 0.5 && <> Extras like the summary card finished by {formatSeconds(view.last)}.</>}
        </p>
        {used.length > 0 && (
          <section aria-label="Models used" className="mt-4">
            <ul className="flex flex-wrap gap-2">
              {used.map((m) => (
                <li key={m.model} title={`${m.model}: ${m.did.join(", ")}`} className="max-w-full rounded-full bg-lightbox px-3 py-1.5 text-[13px]">
                  <span className="font-semibold">{pretty(m.model)}</span>
                  <span className="text-graphite"> · {m.did.join(", ")}{m.seconds > 0 && ` · ${formatSeconds(m.seconds)}`}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </header>
      <Trust stats={s} />
      <Story view={view} now={now} />
      <RunChart events={view.events} now={now} running={running} />
      <details className="group overflow-hidden rounded-[20px] bg-sheet shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
        <summary className="hit flex cursor-pointer list-none items-center justify-between px-5 py-3.5 font-medium [&::-webkit-details-marker]:hidden">
          <span>Every event, in order</span>
          <span className="flex items-center gap-1.5 text-graphite"><span className="tabular">{steps.length}</span>
            <SlidesGlyph name="right" className="size-3.5 transition-transform duration-300 ease-spring group-open:rotate-90 motion-reduce:transition-none" /></span>
        </summary>
        <div className="overflow-x-auto">
        <table className="w-full border-t border-rule text-sm">
          <thead className="sr-only"><tr><th>Time</th><th>Step</th><th>What happened</th></tr></thead>
          <tbody className="divide-y divide-rule">
            {steps.map((s, i) => (
              <tr key={i} className="align-top hover:bg-lightbox">
                <td className="tabular w-16 py-2 pr-2 pl-4 text-right font-mono text-xs text-graphite">{formatSeconds(s.t)}</td>
                <td className="hidden w-32 py-2 pr-2 sm:table-cell"><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${LANE_TONE[s.lane] ?? "bg-lightbox text-graphite"}`}>{s.lane}</span></td>
                <td className={`py-2 pr-4 break-words ${s.tone}`}>{s.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>
    </div>
  );
}

/** "muse-voice-transcribe-1.0" → "Muse Voice Transcribe 1.0"; short words are acronyms ("sam-3.1" → "SAM 3.1"). */
export const pretty = (id: string) => modelName(id).split("-").map((w) => (/^\d/.test(w) ? w : w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");

type Step = { title: string; models: string[]; start: number; end: number; icon: GlyphName };
const span = <E extends TraceEvent>(es: E[], from: (e: E) => number = (e) => e.t) => es.length ? [Math.min(...es.map(from)), Math.max(...es.map((e) => e.t))] as const : null;

/** The run in plain words, in order. Only measured spans from the trace; a step that didn't happen isn't shown. */
function Story({ view, now }: { view: View; now: number }) {
  const ev = view.events;
  const of = <K extends TraceEvent["kind"]>(k: K) => ev.filter((e): e is Extract<TraceEvent, { kind: K }> => e.kind === k);
  const stage = (n: string) => ev.filter((e): e is Extract<TraceEvent, { kind: "stage" }> => e.kind === "stage" && e.name === n);
  const out: Step[] = [];
  const add = (title: string, models: (string | undefined)[], s: readonly [number, number] | null, icon: GlyphName = "sparkle") =>
    s && out.push({ title, models: [...new Set(models.filter((m): m is string => !!m))], start: s[0], end: s[1], icon });

  const fetch = stage("fetch");
  const streamed = view.source?.streaming;
  add(view.ready?.origin === "upload" ? "Received the upload" : `Opened the video on ${site(view.ready?.site) ?? "the web"}${streamed ? ", streamed (nothing downloaded)" : ""}`, [], span<TraceEvent>(fetch.length ? fetch : of("source_ready")), "link");
  const tr = of("transcript").filter((e) => e.lines.length);
  const subs = view.source?.transcript === "subtitles" || tr.some((e) => /subtitle/.test(e.engine));
  if (tr.length || subs)
    add(subs ? "Used the video's own captions, so no speech recognition was needed"
      : `Transcribed ${view.source ? formatTime(view.source.duration) : "the"} of speech, ${plural(tr.length, "part")} at once${tr.some((e) => /muse/.test(e.engine)) ? " (sped up 2x, cut into 3-second pieces)" : ""}`,
    subs ? [] : tr.map((e) => e.engine), span([...stage("audio"), ...tr], (e) => (e.kind === "transcript" ? e.t - e.seconds : e.t)), "wave");
  const scenes = stage("scenes").find((e) => e.state === "end");
  const frames = stage("frames");
  if (scenes) add(`Found ${plural(scenes.cuts ?? 0, "slide or scene change")} and took a keyframe at each`, [], span([...stage("scenes"), ...frames]), "scenes");
  const secs = of("section").filter((e) => e.ok);
  const tries = of("model").filter((e) => /^s\d/.test(e.task));
  const racers = [...new Set(tries.map((e) => e.model))];
  if (secs.length) add(`Wrote ${plural(secs.length, "section")} in parallel${racers.length > 1 ? `, each sent to ${racers.length} models at once, the first good answer kept` : ""}`, secs.map((e) => e.model), span([...tries, ...secs]), "pen");
  const checks = of("check");
  const kept = secs.reduce((n, e) => n + e.notes, 0), dropped = secs.reduce((n, e) => n + e.rejected, 0);
  if (checks.length) add(`Checked every quote against the transcript and every frame against a keyframe: ${plural(kept, "note")} kept${dropped ? `, ${dropped} dropped` : ""}`, [], span(checks), "check");
  const ov = of("model").filter((e) => e.task === "overview");
  if (view.overview.result || of("overview").length) add("Wrote the title and summary", ov.filter((e) => e.state === "win").map((e) => e.model), span([...ov, ...of("overview")]), "notes");
  const vis = of("visual")[0];
  if (vis) add(`Drew out ${plural(vis.takeaways, "takeaway")}${vis.diagram ? ` and a${/^[aeiou]/.test(vis.diagram) ? "n" : ""} ${vis.diagram} diagram` : ""}`, of("model").filter((e) => e.task === "visual" && e.state === "win").map((e) => e.model), span([...of("model").filter((e) => e.task === "visual"), vis]));
  const screen = stage("screen").find((e) => e.state === "end");
  if (screen) add(`Looked at the keyframes and added ${plural(screen.added ?? 0, "checked on-screen note")}`, [], span(stage("screen")), "eye");
  const ocr = stage("ocr").find((e) => e.state === "end");
  if (ocr) add(`Read the text on ${plural(of("frame").length || (stage("ocr")[0]?.frames?.length ?? 0), "keyframe")}`, [ocr.model], span([...stage("ocr"), ...of("frame")]), "text");
  const crop = stage("crop").find((e) => e.state === "end" && !e.error);
  if (crop?.cropped) add(`Cut out ${plural(crop.cropped, "diagram")}`, [crop.model], span(stage("crop")), "crop");
  const card = stage("card").find((e) => e.state === "end");
  if (card) add(card.error ? "Drew a summary card (dropped: its text didn't match)" : "Drew the summary card, then read its text back to check it", [card.model], span(stage("card")), "card");
  if (!out.length) return null;
  const total = Math.max(view.end?.t ?? 0, now, ...out.map((s) => s.end), 0.1);
  return (
    <section aria-labelledby="how-steps">
      <h3 id="how-steps" className="px-5 pb-2 font-display text-xl font-semibold tracking-tight">What happened, step by step</h3>
      <ol className="overflow-hidden rounded-[22px] bg-sheet shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
        {out.map((s) => (
          <li key={s.title} className="grid grid-cols-[2rem_1fr_auto] items-start gap-x-3 border-b border-rule px-4 py-3.5 last:border-b-0 sm:px-5">
            <span aria-hidden className="grid size-8 place-items-center rounded-[9px] bg-scan text-on-scan"><SlidesGlyph name={s.icon} className="size-[18px]" /></span>
            <div className="min-w-0">
              <p className="text-[15px] leading-snug">{s.title}</p>
              {s.models.length > 0 && <p className="mt-0.5 text-[13px] text-graphite">{s.models.map(pretty).join(", ")}</p>}
              {/* where the step sat in the run: a thin track scaled to the whole run */}
              <span aria-hidden className="relative mt-2 block h-1 rounded-full bg-rule">
                <span className="absolute inset-y-0 rounded-full bg-scan" style={{ left: `${(100 * s.start) / total}%`, width: `max(4px, ${(100 * (s.end - s.start)) / total}%)` }} />
              </span>
            </div>
            <span className="tabular pt-0.5 text-right text-[15px]">
              <span className="sr-only">took </span><span className="font-semibold">{formatSeconds(s.end - s.start)}</span>
              <span className="block text-[13px] text-graphite">by {formatSeconds(s.end)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

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

const LANE_TONE: Record<string, string> = {
  Source: "bg-lightbox text-ink", Transcript: "bg-lightbox text-cyan", Frames: "bg-lightbox text-pink",
  Notes: "bg-scan-soft text-scan-ink", Check: "bg-proof-soft text-proof", Extras: "bg-lightbox text-wait", Result: "bg-proof-soft text-proof",
};
function laneOf(e: TraceEvent): string {
  if (e.kind === "source_ready" || e.kind === "source" || e.kind === "plan") return "Source";
  if (e.kind === "transcript" || (e.kind === "stage" && e.name === "audio")) return "Transcript";
  if (e.kind === "frame" || e.kind === "keyframes_failed" || (e.kind === "stage" && ["scenes", "frames", "crop", "ocr", "screen"].includes(e.name))) return "Frames";
  if (e.kind === "check") return "Check";
  if (e.kind === "stage" && e.name === "card") return "Extras";
  if ((e.kind === "model" || e.kind === "watch") && OTHER[e.task] && e.task !== "overview") return "Extras";
  if (e.kind === "done" || e.kind === "failed") return "Result";
  return "Notes";
}

const BAR: Record<Bar["state"], string> = {
  running: "animate-pulse bg-scan text-on-scan motion-reduce:animate-none",
  done: "bg-graphite/45 text-ink",
  won: "bg-proof text-white dark:text-black",
  lost: "bg-graphite/15 text-graphite",
  failed: "bg-strike text-white",
};
const OUTCOME: Record<Bar["state"], string> = { running: "working now", done: "done", won: "used in the notes", lost: "spare copy, finished but not needed", failed: "failed" };
const LEGEND = [["done", "a step"], ["won", "model answer used"], ["lost", "spare copy (not needed)"], ["failed", "failed"], ["running", "working now"]] as const;
// Plain-English lane names; trace.ts keeps the short ids.
const LANE_LABEL: Record<string, string> = {
  Source: "Getting the video", Transcript: "Speech to text", "Scene changes": "Slide changes", Keyframes: "Keyframes", Diagrams: "Diagrams",
  "Screen text": "Text on screen", Notes: "Writing notes", Title: "Title & summary", "Summary card": "Summary card", "On screen": "On-screen notes", Takeaways: "Takeaways", "Go deeper": "Web search (older runs)",
};

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
  const lanes = lanesOf(events, now);
  const end = Math.max(now, ...lanes.flatMap((l) => l.bars.map((b) => b.end)), 0.1);
  const step = [1, 2, 5, 10, 15, 30, 60].find((n) => end / n <= 6) ?? 120;
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
  const x = (t: number) => `${(100 * t) / end}%`;
  const ROW = 34;
  return (
    <section aria-label="The run, step by step" className={CARD}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl font-semibold tracking-tight">Second by second <span className="tabular font-normal text-graphite">{formatSeconds(end)}</span></h3>
        <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-graphite">
          {LEGEND.map(([k, label]) => (
            <li key={k} className="flex items-center gap-1.5"><span aria-hidden className={`h-2.5 w-4 rounded-full ${BAR[k].replace("animate-pulse ", "")}`} />{label}</li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-[5.5rem_1fr] sm:grid-cols-[9rem_1fr]">
        <span />
        <div className="tabular relative h-5 text-[11px] text-graphite">
          {ticks.map((t) => <span key={t} className="absolute top-0 -translate-x-1/2 first:translate-x-0" style={{ left: x(t) }}>{t}s</span>)}
        </div>
        {lanes.map((lane) => {
          const laneRows = rows(lane.bars);
          const h = (ROW - 8) / laneRows.length;
          return (
            <div key={lane.name} className="contents">
              <span className="flex items-center gap-2 border-t border-rule pr-2 text-[12px] leading-tight font-medium sm:text-[13px]" style={{ height: ROW }}>
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[lane.name] ?? "bg-graphite"}`} />
                <span>{LANE_LABEL[lane.name] ?? lane.name}</span>
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

const DOT: Record<string, string> = {
  Source: "bg-graphite", Transcript: "bg-cyan", "Scene changes": "bg-pink", Keyframes: "bg-pink", "Screen text": "bg-pink",
  Notes: "bg-scan", "On screen": "bg-scan", Title: "bg-scan", Takeaways: "bg-wait", Diagrams: "bg-pink", "Go deeper": "bg-wait", Actions: "bg-wait", Tests: "bg-wait", "Summary card": "bg-wait",
};

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
