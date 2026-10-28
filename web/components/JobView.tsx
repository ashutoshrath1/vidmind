"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ProofView from "@/components/Proof";
import Workspace, { NotFound } from "@/components/Workspace";
import { type JobStatus, type LearnResult, jobUrl } from "@/lib/api";
import { saveRecent } from "@/lib/recent";
import { type TraceEvent, buildView } from "@/lib/trace";

const REPLAY_S = 5; // every replay lasts this long, however long the real run took

export default function JobView() {
  const { id } = useParams<{ id?: string }>();
  const params = useSearchParams();
  const proof = params.get("view") === "proof"; // the read-only page a shared proof link opens
  const at = Math.max(0, Math.floor(Number(params.get("t"))) || 0); // ?t=125: a proof or library link opens the video at that second
  // Next keeps visited routes mounted in the background; keying by id stops one job's state leaking into another.
  if (!id) return null;
  return proof ? <ProofView key={id} id={id} at={at} /> : <Job key={id} id={id} at={at} />;
}

function Job({ id, at }: { id: string; at: number }) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<LearnResult | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false); // expired, deleted, or a mistyped link
  const [clock, setClock] = useState({ offset: 0, wall: 0 }); // server clock - browser clock; browser now
  const shown = useRef(-1); // sections_done of the result currently on screen
  const [witnessed, setWitnessed] = useState(false); // saw the job running, so its finish gets celebrated
  const [replay, setReplay] = useState<number | null>(null); // performance.now() when the replay started
  const [playhead, setPlayhead] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    // One connection: the job status whenever it changes, and every pipeline step as a `trace` event.
    const source = new EventSource(`${jobUrl(id)}/events`);
    const pending: TraceEvent[] = [];
    let flush: number | null = null;
    source.addEventListener("trace", (msg) => {
      // Batch a burst of events (12 frames read in a second) into one render.
      pending.push(JSON.parse((msg as MessageEvent).data));
      flush ??= requestAnimationFrame(() => {
        flush = null;
        const batch = pending.splice(0); // outside the updater: React may call an updater twice
        setEvents((xs) => [...xs, ...batch]);
      });
    });
    source.onmessage = async (msg) => {
      const status: JobStatus = JSON.parse(msg.data);
      finished = status.status === "done" || status.status === "failed";
      if (finished) source.close(); // otherwise EventSource reconnects when the server ends the stream
      if (status.server_time) setClock({ offset: status.server_time - Date.now() / 1000, wall: Date.now() });
      setJob(status);
      if (!finished) setWitnessed(true);
      // Sections are published as they finish; refetch the result whenever another one lands.
      const ready = status.status === "done" ? Infinity : (status.sections_done ?? 0);
      if (ready > 0 && ready !== shown.current) {
        shown.current = ready;
        const r = await fetch(`${jobUrl(id)}/result`);
        const body = r.ok ? await r.json() : null;
        if (body && !cancelled && shown.current === ready) setResult(body); // a newer section may have landed meanwhile
      }
    };
    source.onerror = () => {
      // A dropped connection retries on its own; CLOSED means the job is gone or the API is down. Ask which.
      if (finished || cancelled || source.readyState !== EventSource.CLOSED) return;
      fetch(jobUrl(id)).then(
        (r) => !cancelled && (r.status === 404 ? setMissing(true) : setError(`The VidMind API answered ${r.status}. Try reloading.`)),
        () => !cancelled && setError("Can't reach the VidMind API. Check that it is running on port 8000, then reload."),
      );
    };
    return () => {
      cancelled = true;
      source.close();
      if (flush) cancelAnimationFrame(flush);
    };
  }, [id]);

  // Replay feeds the real trace back through the same view, at its real timestamps (slowed down).
  const fullEnd = useMemo(() => buildView(events).end?.t ?? 0, [events]);
  useEffect(() => {
    if (replay === null) return;
    let raf = requestAnimationFrame(function step(t) {
      const head = ((t - replay) / 1000) * (fullEnd / REPLAY_S);
      setPlayhead(head);
      if (head < fullEnd) raf = requestAnimationFrame(step); // stop on the last event, so the finish shows at once
      else setReplay(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [replay, fullEnd]);
  const replaying = replay !== null;
  const view = useMemo(() => buildView(replaying ? events.filter((e) => e.t <= playhead) : events), [events, replaying, playhead]);
  const running = !!job && job.status !== "done" && job.status !== "failed";

  // Seconds since the job was created, on the server's clock; ticks while the job runs, freezes when it ends.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick(Date.now()), 100);
    return () => clearInterval(timer);
  }, [running]);
  // The title, takeaways and diagram (listen-first runs), then the card and web sources, land a few seconds after
  // the notes; pick each up as it arrives.
  const pending = job?.status === "done" && !!result && (!!result.pending || (!result.card_url && !result.further?.length));
  useEffect(() => {
    if (!pending) return;
    let tries = 0;
    const timer = setInterval(async () => {
      if (++tries > 20) return clearInterval(timer);
      const body: LearnResult | null = await fetch(`${jobUrl(id)}/result`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!body) return;
      setResult(body);
      if (!body.pending && (body.card_url || body.further?.length || body.claims?.length)) clearInterval(timer);
    }, 1500);
    return () => clearInterval(timer);
  }, [pending, id]);
  // Remembered in this browser, so the home page and the library can reopen it.
  const finishedTitle = job?.status === "done" ? result?.title : undefined;
  const createdAt = job?.created_at;
  const mode = result?.mode;
  const keepUntil = job?.keep_until;
  useEffect(() => {
    if (finishedTitle)
      saveRecent({ id, title: finishedTitle, at: (createdAt ?? Date.now() / 1000) * 1000, mode, keep_until: keepUntil ? keepUntil * 1000 : null });
  }, [id, finishedTitle, createdAt, mode, keepUntil]);
  const wall = tick || clock.wall;
  const live = view.end ? view.end.t : job?.created_at && wall ? Math.max(view.last, wall / 1000 + clock.offset - job.created_at) : view.last;
  const now = replaying ? Math.min(playhead, fullEnd) : live;

  if (missing) return <NotFound />;
  return (
    <Workspace
      jobId={id}
      at={at}
      job={job}
      result={result}
      view={view}
      now={now}
      error={error ?? (job?.status === "failed" ? job.error : null)}
      replaying={replaying}
      celebrate={witnessed}
      onReplay={
        events.length && fullEnd
          ? () => {
              setPlayhead(0);
              setWitnessed(true);
              setReplay(performance.now());
            }
          : undefined
      }
    />
  );
}
