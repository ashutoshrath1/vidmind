// The job's trace (api: jobs.tracer / pipeline emit) streamed as server-sent events, folded into what the page shows.
// Relative .ts imports only: `node --test lib/*.test.ts` runs this file without the Next toolchain.
import type { Note } from "./api.ts";
import { estimate } from "./estimate.ts";

export type Rejected = { text: string; reasons: string[] };

export type Line = { start: number; end: number; text: string };

export type TraceEvent = { t: number } & (
  | {
      kind: "source_ready";
      origin: "link" | "upload";
      title?: string | null;
      channel?: string | null;
      site?: string;
      duration?: number;
      seconds?: number;
      streaming?: boolean;
      subtitles?: boolean;
      size_mb?: number;
    }
  | { kind: "stage"; name: string; state: "start" | "end"; seconds?: number; detail?: string; task?: string; cuts?: number; frames?: { i: number; at: number; url: string }[]; cropped?: number; of?: number; error?: string; model?: string; added?: number }
  | { kind: "source"; duration: number; streaming: boolean; youtube_id?: string | null; transcript: "subtitles" | "speech" | "none"; caption_lines: number; models: string[] }
  | { kind: "plan"; sections: [number, number][] }
  | { kind: "transcript"; task: string; engine: string; seconds: number; lines: Line[] }
  | { kind: "frame"; i: number; at: number; url: string; text: string; conf: number; low_conf: boolean; seconds: number; figure?: string | null; box?: [number, number, number, number] | null }
  | { kind: "model"; task: string; model: string; state: "start" | "end" | "fail" | "win"; reason?: string; seconds?: number; error?: string }
  | { kind: "check"; task: string; model: string; round: number; notes: number; problems: string[]; kept: number; rejected?: Rejected[] }
  | { kind: "section"; task: string; ok: boolean; model: string; title: string | null; notes: number; rejected: number }
  | { kind: "note"; task: string; model: string; note: Note } // a checked note, shown while its section is still being written
  | { kind: "overview"; title: string; tldr: string }
  | { kind: "keyframes_failed"; error: string }
  | { kind: "clip"; task: string; at: [number, number]; kb: number; seconds: number }
  | { kind: "watch"; task: string; model: string; seconds: number }
  | { kind: "visual"; takeaways: number; diagram?: string | null }
  | { kind: "extras"; card?: string | null }
  | { kind: "done" }
  | { kind: "failed"; error: string }
);

export type Attempt = {
  model: string;
  reason: string;
  start: number;
  seconds?: number; // set once it finished
  state: "running" | "ended" | "failed" | "won";
  error?: string;
};

export type Check = Extract<TraceEvent, { kind: "check" }>;

export type SectionView = {
  i: number;
  lo: number;
  hi: number;
  lines?: Line[];
  engine?: string;
  transcribedAt?: number;
  transcribeSeconds?: number;
  attempts: Attempt[];
  checks: Check[];
  notes: Note[]; // checked notes so far, before the section's final notes land
  done?: Extract<TraceEvent, { kind: "section" }>;
};

export type FrameView = { i: number; at: number; url: string; read?: Extract<TraceEvent, { kind: "frame" }> };

export type StageView = { start?: number; end?: number; seconds?: number; detail?: string };

export type View = {
  ready?: Extract<TraceEvent, { kind: "source_ready" }>;
  source?: Extract<TraceEvent, { kind: "source" }>;
  stages: Record<string, StageView>;
  cuts?: number;
  keyframesError?: string; // frames could not be read; notes came from the transcript alone
  sections: SectionView[];
  frames: FrameView[];
  overview: { attempts: Attempt[]; result?: { title: string; tldr: string } };
  end?: { t: number; ok: boolean; error?: string };
  last: number; // time of the latest event
  events: TraceEvent[];
};

export function buildView(events: TraceEvent[]): View {
  const v: View = { stages: {}, sections: [], frames: [], overview: { attempts: [] }, last: 0, events };
  const section = (task: string) => v.sections[Number(task.slice(1))];
  const attempts = (task: string) => (task === "overview" ? v.overview.attempts : section(task)?.attempts);

  for (const e of events) {
    v.last = Math.max(v.last, e.t);
    switch (e.kind) {
      case "source_ready":
        v.ready = e;
        break;
      case "source":
        v.source = e;
        break;
      case "stage": {
        const s = (v.stages[e.name] ??= {});
        if (e.state === "start") Object.assign(s, { start: e.t, detail: e.detail });
        else Object.assign(s, { end: e.t, seconds: e.seconds });
        if (e.name === "scenes" && e.cuts !== undefined) v.cuts = e.cuts;
        if (e.frames) v.frames = e.frames.map((f) => ({ ...f }));
        break;
      }
      case "plan":
        v.sections = e.sections.map(([lo, hi], i) => ({ i, lo, hi, attempts: [], checks: [], notes: [] }));
        break;
      case "transcript": {
        const s = section(e.task);
        if (s) Object.assign(s, { lines: e.lines, engine: e.engine, transcribedAt: e.t, transcribeSeconds: e.seconds });
        break;
      }
      case "frame": {
        const f = v.frames[e.i];
        if (f) f.read = e;
        else v.frames[e.i] = { i: e.i, at: e.at, url: e.url, read: e };
        break;
      }
      case "model": {
        const list = attempts(e.task);
        if (!list) break;
        if (e.state === "start") {
          list.push({ model: e.model, reason: e.reason ?? "first", start: e.t, state: "running" });
          break;
        }
        const a = list.findLast((x) => x.model === e.model);
        if (!a) break;
        if (e.state === "win") a.state = "won";
        else {
          a.seconds = e.seconds;
          if (a.state !== "won") a.state = e.state === "fail" ? "failed" : "ended";
          a.error = e.error;
        }
        break;
      }
      case "check":
        section(e.task)?.checks.push(e);
        break;
      case "note":
        section(e.task)?.notes.push(e.note);
        break;
      case "section": {
        const s = section(e.task);
        if (s) s.done = e;
        break;
      }
      case "overview":
        v.overview.result = { title: e.title, tldr: e.tldr };
        break;
      case "keyframes_failed":
        v.keyframesError = e.error;
        break;
      case "done":
        v.end = { t: e.t, ok: true };
        break;
      case "failed":
        v.end = { t: e.t, ok: false, error: e.error };
        break;
    }
  }
  return v;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Seconds until the last section is written, from what this job has measured so far; undefined until the
 * section plan exists or once the job ended. Notes start after keyframes are read, then each section takes about
 * as long as the sections already finished took (or a first guess). */
export function secondsLeft(v: View, now: number): number | undefined {
  if (v.end) return undefined;
  if (!v.sections.length) {
    // Before the plan exists: a first estimate from the video's length, so the clock never just says "estimating".
    const duration = v.source?.duration ?? v.ready?.duration;
    if (!duration) return undefined;
    const subtitles = v.source ? v.source.transcript === "subtitles" : !!v.ready?.subtitles;
    return Math.max(1, estimate({ duration, height: v.source?.streaming || v.ready?.streaming ? 360 : 720, subtitles }).total - now);
  }
  const finished = v.sections.filter((s) => s.done);
  const noteS =
    avg(finished.map((s) => s.done!.t - (s.attempts[0]?.start ?? s.done!.t))) ??
    avg(v.sections.flatMap((s) => s.attempts.filter((a) => a.seconds !== undefined).map((a) => a.seconds!))) ??
    6;
  let framesReady = now;
  if (!v.stages.ocr?.end) {
    const read = v.frames.filter((f) => f.read);
    const perFrame = avg(read.map((f) => f.read!.seconds)) ?? 0.3;
    const unread = v.frames.length ? v.frames.length - read.length : 12;
    framesReady = now + unread * perFrame + (v.stages.scenes?.end ? 0 : 2) + (v.stages.frames?.end ? 0 : 1);
  }
  const transcribeS = v.source?.transcript === "speech" ? (avg(v.sections.filter((s) => s.lines).map((s) => s.transcribeSeconds!)) ?? 3) : 0;
  let latest = now;
  let waiting = 0;
  for (const s of v.sections) {
    if (s.done) continue;
    const begun = s.attempts[0]?.start;
    const start = begun ?? Math.max(framesReady, now + (s.lines ? 0 : ++waiting * transcribeS));
    latest = Math.max(latest, start + noteS);
  }
  return Math.max(1, latest - now);
}

export type ModelJob = { model: string; did: string[]; seconds: number };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const JOB: Record<string, string> = { overview: "the title and summary", visual: "the takeaways and diagram", meet: "the actions", test: "the test scenarios" };

/** Every model that worked on this video and what it did, read from the trace. No model is named in code: the
 * names come from the events (the transcriber, the notes pool, OCR, segmentation, the card). */
export function modelsUsed(events: TraceEvent[]): ModelJob[] {
  const by = new Map<string, { did: Map<string, number>; seconds: number; order: number }>();
  const add = (model: string | undefined, what: string, n = 1, seconds = 0) => {
    if (!model) return;
    const m = by.get(model) ?? { did: new Map(), seconds: 0, order: by.size };
    m.did.set(what, (m.did.get(what) ?? 0) + n);
    m.seconds += seconds;
    by.set(model, m);
  };
  const plan = events.find((e) => e.kind === "plan");
  const span = (task: string) => (plan?.kind === "plan" ? (plan.sections[Number(task.slice(1))] ?? [0, 0]) : [0, 0]).reduce((a, b) => b - a);
  for (const e of events) {
    if (e.kind === "transcript" && e.lines.length && !/subtitle/.test(e.engine)) add(e.engine, "listen", span(e.task), e.seconds);
    if (e.kind === "watch") add(e.model, "watch", e.seconds);
    if (e.kind === "model" && e.state === "win") add(e.model, e.task.startsWith("s") && !JOB[e.task] ? "section" : `job:${e.task}`);
    if (e.kind === "model" && (e.state === "end" || e.state === "fail")) add(e.model, "call", 1, e.seconds ?? 0);
    if (e.kind === "stage" && e.state === "end" && e.model) {
      if (e.name === "crop") add(e.model, `crop:${e.cropped ?? 0}`, e.of ?? 0, e.seconds ?? 0);
      if (e.name === "ocr") add(e.model, "ocr", events.filter((x) => x.kind === "frame").length, e.seconds ?? 0);
      if (e.name === "card") add(e.model, e.error ? "card-rejected" : "card", 1, e.seconds ?? 0);
    }
  }
  return [...by.entries()].sort((a, b) => a[1].order - b[1].order).map(([model, m]) => ({
    model,
    seconds: m.seconds,
    did: [...m.did.entries()].flatMap(([what, n]) => {
      if (what === "listen") return [`transcribed ${clock(n)} of speech`];
      if (what === "watch") return [`watched ${clock(n)} of video`];
      if (what === "section") return [`wrote ${plural(n, "section")}`];
      if (what.startsWith("job:")) return [`wrote ${JOB[what.slice(4)] ?? what.slice(4)}`];
      if (what === "call") return m.did.size === 1 ? [`${plural(n, "call")}, none chosen`] : [];
      if (what.startsWith("crop:")) return [`found the screen in ${plural(n, "keyframe")}, cropped ${what.slice(5)}`];
      if (what === "ocr") return [`read the text on ${plural(n, "keyframe")}`];
      if (what === "card") return ["drew the summary card (its text was checked)"];
      if (what === "card-rejected") return ["drew a card that was dropped: its text didn't match"];
      return [];
    }),
  }));
}

export type Bar = { start: number; end: number; label: string; model?: string; state: "running" | "done" | "won" | "lost" | "failed"; detail?: string };
export type Lane = { name: string; bars: Bar[] };

const LANE_OF_STAGE: Record<string, string> = {
  fetch: "Source", audio: "Transcript", scenes: "Scene changes", frames: "Keyframes", crop: "Diagrams", ocr: "Screen text", card: "Summary card", screen: "On screen", web: "Go deeper",
  article: "Article", images: "Images", slides: "Slides",
};
const LANE_OF_TASK: Record<string, string> = { overview: "Title", visual: "Takeaways", meet: "Actions", test: "Tests", screen: "On screen" };
const LANE_ORDER = ["Source", "Transcript", "Scene changes", "Keyframes", "Diagrams", "Screen text", "Notes", "On screen", "Title", "Takeaways", "Actions", "Tests", "Article", "Images", "Slides", "Go deeper", "Summary card"];
const STAGE_LABEL: Record<string, string> = { fetch: "fetch", audio: "audio", scenes: "scan", frames: "grab", crop: "track diagrams", ocr: "read text", card: "draw card", screen: "read keyframes", web: "web search", article: "write article", images: "draw images", slides: "explain slides" };

/** The run as lanes of timed bars (the "behind the scenes" chart): every stage, transcription part and model attempt.
 * Bars still open at `now` are running, so the same chart animates live and in a replay. */
export function lanesOf(events: TraceEvent[], now: number): Lane[] {
  const lanes = new Map<string, Bar[]>();
  const put = (lane: string, bar: Bar) => lanes.set(lane, [...(lanes.get(lane) ?? []), bar]);
  const open = new Map<string, Extract<TraceEvent, { kind: "stage" }>>();
  const tries = new Map<string, Extract<TraceEvent, { kind: "model" }>>();
  const taskName = (t: string) => (/^s\d+$/.test(t) ? `section ${Number(t.slice(1)) + 1}` : t);
  for (const e of events) {
    if (e.kind === "stage" && e.state === "start") open.set(e.name, e);
    if (e.kind === "stage" && e.state === "end" && LANE_OF_STAGE[e.name]) {
      const s = open.get(e.name);
      open.delete(e.name);
      put(LANE_OF_STAGE[e.name], { start: s?.t ?? e.t - (e.seconds ?? 0), end: e.t, label: STAGE_LABEL[e.name], model: e.model,
        state: e.error ? "failed" : "done", detail: e.error ?? s?.detail });
    }
    if (e.kind === "transcript" && e.seconds)
      put("Transcript", { start: e.t - e.seconds, end: e.t, label: taskName(e.task), model: e.engine, state: "done", detail: `${e.lines.length} lines` });
    if (e.kind === "model") {
      const key = `${e.task}|${e.model}`;
      if (e.state === "start") tries.set(key, e);
      else if (e.state === "win") {
        const bars = lanes.get(LANE_OF_TASK[e.task] ?? "Notes") ?? [];
        const b = bars.findLast((x) => x.model === e.model && x.label === taskName(e.task));
        if (b) b.state = "won";
      } else {
        const s = tries.get(key);
        tries.delete(key);
        put(LANE_OF_TASK[e.task] ?? "Notes", { start: s?.t ?? e.t - (e.seconds ?? 0), end: e.t, label: taskName(e.task), model: e.model,
          state: e.state === "fail" ? "failed" : "lost", detail: e.error ?? (s?.reason === "hedge" ? "spare copy, started at the same time" : undefined) });
      }
    }
  }
  for (const s of open.values()) if (LANE_OF_STAGE[s.name]) put(LANE_OF_STAGE[s.name], { start: s.t, end: now, label: STAGE_LABEL[s.name], model: s.model, state: "running", detail: s.detail });
  for (const [key, s] of tries) put(LANE_OF_TASK[s.task] ?? "Notes", { start: s.t, end: now, label: taskName(key.split("|")[0]), model: s.model, state: "running" });
  return LANE_ORDER.filter((n) => lanes.has(n)).map((name) => ({ name, bars: lanes.get(name)! }));
}
