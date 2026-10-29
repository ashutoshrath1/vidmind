import { formatSeconds, formatTime, modelName } from "@/lib/api";
import { type Bar, type TraceEvent, type View, lanesOf } from "@/lib/trace";

/** Everything the pipeline did: a 3D lane chart of every stage and model attempt, then the full log as a table. */
export default function Timeline({ view, now, running }: { view: View; now: number; running: boolean }) {
  if (!view.events.length)
    return <p className="text-graphite">This result was made before VidMind kept a step-by-step record.</p>;
  const steps = view.events.flatMap((e) => {
    const text = sentence(e);
    return text ? [{ t: e.t, text, tone: tone(e), lane: laneOf(e) }] : [];
  });
  return (
    <div className="space-y-6">
      <RunChart events={view.events} now={now} running={running} />
      <details className="group rounded-lg bg-sheet ring-1 ring-rule">
        <summary className="hit flex cursor-pointer items-center justify-between px-4 py-3 font-display font-semibold">
          <span>Full log <span className="tabular font-normal text-graphite">{steps.length}</span></span>
          <span aria-hidden className="text-graphite transition group-open:rotate-180">⌄</span>
        </summary>
        <table className="w-full border-t border-rule text-sm">
          <thead className="sr-only"><tr><th>Time</th><th>Step</th><th>What happened</th></tr></thead>
          <tbody className="divide-y divide-rule">
            {steps.map((s, i) => (
              <tr key={i} className="align-top hover:bg-lightbox">
                <td className="tabular w-16 py-2 pr-2 pl-4 text-right font-mono text-xs text-graphite">{formatSeconds(s.t)}</td>
                <td className="w-32 py-2 pr-2"><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${LANE_TONE[s.lane] ?? "bg-lightbox text-graphite"}`}>{s.lane}</span></td>
                <td className={`py-2 pr-4 ${s.tone}`}>{s.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const LANE_TONE: Record<string, string> = {
  Source: "bg-ink/10 text-ink", Transcript: "bg-sky-500/15 text-sky-700 dark:text-sky-300", Frames: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  Notes: "bg-scan-soft text-scan-ink", Check: "bg-proof-soft text-proof", Extras: "bg-pink-500/15 text-pink-700 dark:text-pink-300", Result: "bg-proof-soft text-proof",
};
function laneOf(e: TraceEvent): string {
  if (e.kind === "source_ready" || e.kind === "source" || e.kind === "plan") return "Source";
  if (e.kind === "transcript" || (e.kind === "stage" && e.name === "audio")) return "Transcript";
  if (e.kind === "frame" || e.kind === "keyframes_failed" || (e.kind === "stage" && ["scenes", "frames", "crop", "ocr"].includes(e.name))) return "Frames";
  if (e.kind === "check") return "Check";
  if (e.kind === "stage" && e.name === "card") return "Extras";
  if ((e.kind === "model" || e.kind === "watch") && OTHER[e.task] && e.task !== "overview") return "Extras";
  if (e.kind === "done" || e.kind === "failed") return "Result";
  return "Notes";
}

const BAR: Record<Bar["state"], string> = {
  running: "scanning bg-scan text-on-scan",
  done: "bg-ink/70 text-lightbox",
  won: "bg-proof text-white",
  lost: "bg-[repeating-linear-gradient(135deg,rgb(107_114_128/0.35)_0_4px,rgb(107_114_128/0.15)_4px_8px)] text-ink",
  failed: "bg-strike text-white",
};
const OUTCOME: Record<Bar["state"], string> = { running: "working now", done: "done", won: "chosen: its result is used", lost: "finished as a backup, not used", failed: "failed" };
const LEGEND = [["won", "chosen"], ["lost", "backup, unused"], ["failed", "failed"], ["running", "working"], ["done", "step"]] as const;

const barLabel = (b: Bar) => (b.model ? `${b.label.replace("section ", "§")} · ${modelName(b.model)}` : b.label);

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
  const ROW = 30;
  return (
    <section aria-label="The run, step by step" className="rounded-xl bg-sheet p-4 ring-1 ring-rule">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-semibold">The run, {formatSeconds(end)}</h2>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-graphite">
          {LEGEND.map(([k, label]) => (
            <li key={k} className="flex items-center gap-1.5"><span className={`h-2.5 w-3.5 rounded-sm ${BAR[k].replace("scanning ", "")}`} />{label}</li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-[7.5rem_1fr]">
        <span />
        <div className="relative h-5 border-b border-rule font-mono text-[10px] text-graphite">
          {ticks.map((t) => <span key={t} className="absolute top-0 -translate-x-1/2 first:translate-x-0" style={{ left: x(t) }}>{t}s</span>)}
        </div>
        {lanes.map((lane) => {
          const laneRows = rows(lane.bars);
          const h = (ROW - 8) / laneRows.length;
          return (
            <div key={lane.name} className="contents">
              <span className="flex items-center gap-2 border-b border-rule pr-2 text-xs font-semibold" style={{ height: ROW }}>
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[lane.name] ?? "bg-graphite"}`} />
                <span className="truncate">{lane.name}</span>
              </span>
              <div className="relative border-b border-rule" style={{ height: ROW }}>
                {ticks.map((t) => <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-rule/70" style={{ left: x(t) }} />)}
                {laneRows.map((row, ri) => row.map((b, i) => (
                  <Lens key={`${ri}-${i}`} className="absolute" style={{ top: 4 + ri * h, height: Math.max(3, h - 2), left: x(b.start), width: `max(6px, ${x(b.end - b.start)})` }}
                    title={barLabel(b)}
                    lines={[`${formatSeconds(b.start)} to ${formatSeconds(b.end)}, ${formatSeconds(b.end - b.start)}`, OUTCOME[b.state], ...(b.detail ? [b.detail] : [])]}>
                    <span className={`flex h-full items-center overflow-hidden rounded-[3px] px-1.5 text-[10px] font-semibold whitespace-nowrap transition-[width] duration-300 ${BAR[b.state]}`}>
                      {laneRows.length === 1 && (b.end - b.start) / end >= 0.2 && barLabel(b)}
                    </span>
                  </Lens>
                )))}
                {running && <span aria-hidden className="absolute inset-y-0 w-0.5 bg-scan shadow-[0_0_8px_var(--scan)]" style={{ left: x(now) }} />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const DOT: Record<string, string> = {
  Source: "bg-ink", Transcript: "bg-sky-500", "Scene changes": "bg-violet-500", Keyframes: "bg-violet-500", "Screen text": "bg-violet-500",
  Notes: "bg-scan", Title: "bg-scan", Takeaways: "bg-pink-500", Diagrams: "bg-violet-500", "Go deeper": "bg-pink-500", Actions: "bg-pink-500", Tests: "bg-pink-500", "Summary card": "bg-pink-500",
};

/** A focusable target that shows a magnifier-glass card with its details on hover and keyboard focus. */
export function Lens({ title, lines, children, className = "", style, below = false }: { title: string; lines: string[]; children: React.ReactNode; className?: string; style?: React.CSSProperties; below?: boolean }) {
  return (
    <span tabIndex={0} aria-label={`${title}. ${lines.join(". ")}`} style={style}
      className={`group/lens outline-none hover:z-30 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-scan ${className}`}>
      {children}
      <span role="tooltip" className={`pointer-events-none absolute left-1/2 z-40 hidden w-max max-w-72 -translate-x-1/2 group-hover/lens:block group-focus-visible/lens:block ${below ? "top-full mt-2" : "bottom-full mb-2"}`}>
        <span className="pop relative block rounded-2xl bg-ink/75 px-3.5 py-2.5 text-left text-xs leading-relaxed text-lightbox shadow-2xl ring-1 ring-lightbox/20 backdrop-blur-md">
          <span aria-hidden className="absolute -top-2 -left-2 grid size-6 place-items-center rounded-full bg-scan text-[11px] text-on-scan shadow">🔍</span>
          <span className="block font-semibold">{title}</span>
          {lines.map((l, i) => <span key={i} className="block text-lightbox/70">{l}</span>)}
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
        : `Found “${e.title}” on ${e.site} in ${formatSeconds(e.seconds ?? 0)}: ${formatTime(e.duration ?? 0)} long, ${e.subtitles ? "with creator subtitles" : "no subtitles"}${e.streaming ? ", will stream it" : ""}`;
    case "stage":
      if (e.state === "start") return e.detail ?? null;
      return {
        fetch: `Video ready in ${formatSeconds(e.seconds ?? 0)}`,
        audio: `Audio in memory after ${formatSeconds(e.seconds ?? 0)}`,
        scenes: `Found ${e.cuts} scene changes in ${formatSeconds(e.seconds ?? 0)}`,
        frames: `Keyframes captured in ${formatSeconds(e.seconds ?? 0)}`,
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
        start: `${modelName(e.model)} started on ${task(e.task)}${e.reason === "hedge" ? ", because the first model was slow" : e.reason === "fallback" ? ", after a failure" : ""}`,
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
    case "clip":
      return `${Task(e.task)}: cut ${formatTime(e.at[0])}-${formatTime(e.at[1])} as a ${e.kb} KB video clip`;
    case "watch":
      return `${modelName(e.model)} is watching ${formatTime(e.seconds)} of video for ${task(e.task)}`;
    case "keyframes_failed":
      return `Couldn't read the video frames (${e.error}); notes come from the transcript alone`;
    case "done":
      return "Done";
    case "failed":
      return `Stopped: ${e.error}`;
  }
}
