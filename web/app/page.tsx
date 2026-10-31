"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { markLaunch } from "@/components/Ambient";
import { HomeFooter, HomeNav } from "@/components/HomeNav";
import Icon from "@/components/Icon";
import { STATS } from "@/components/Landing";
import Reveal from "@/components/Reveal";
import { Button, Chip } from "@/components/ui";
import { API_URL, MAX_MINUTES, MAX_UPLOAD_MB, formatSeconds, formatTime } from "@/lib/api";
import { estimate } from "@/lib/estimate";
import { MODEL_BRAND } from "@/lib/site";
import { parseRecent, readRecent, subscribeRecent } from "@/lib/recent";

type Created = { id: string; reused?: boolean };
type Meta = { duration: number; height: number };
// A video analysed before opens its earlier result instantly; the result page says so.
const jobPath = (body: Created) => `/jobs/${body.id}${body.reused ? "?reused=1" : ""}`;
const isLink = (s: string) => /^https?:\/\/\S+\.\S+/.test(s.trim());
const sizeLabel = (bytes: number) => {
  const [n, unit] = bytes >= 2 ** 30 ? [bytes / 2 ** 30, "GB"] : [bytes / 2 ** 20, "MB"];
  return `${Number(n.toFixed(n < 10 ? 1 : 0))} ${unit}`; // "0.4 MB", "38 MB", "2 GB"
};
const typicalYoutube = estimate({ duration: 300, height: 360, subtitles: true }).total;

export default function Home() {
  const router = useRouter();
  // Submitting lifts the page away and the result page settles in. The app keeps visited pages alive in the
  // background, so the launch (and the safety-net timer) is undone when this page is hidden.
  const [launching, setLaunching] = useState(false);
  const fallback = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => {
    setLaunching(false);
    clearTimeout(fallback.current);
  }, []);
  const go = (body: Created) => {
    const path = jobPath(body);
    router.prefetch(path);
    markLaunch();
    setLaunching(true);
    setTimeout(() => router.push(path), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420);
    // If client navigation stalls (it did once mid-reload), load the page directly.
    fallback.current = setTimeout(() => location.pathname === "/" && location.assign(path), 4000);
  };

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <HomeNav current="/" />
      <main className={`flex-1 overflow-x-clip ${launching ? "launch-out" : ""}`}>
        <section className="mx-auto max-w-5xl px-4 pt-16 pb-14 text-center sm:px-6 sm:pt-24">
          <h1 className="font-display text-[2.75rem] leading-[1.05] font-bold tracking-[-0.03em] text-balance sm:text-7xl lg:text-[5.5rem]">
            Any video.<br /><span className="text-graphite">Notes with proof.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[40ch] text-lg leading-relaxed text-graphite sm:text-xl">
            VidMind watches, listens and reads every slide with {MODEL_BRAND}. Each point links to the second it came from.
          </p>
          <div id="start" className="mx-auto mt-10 max-w-2xl text-left">
            <Composer onDone={go} />
            <RecentNotes />
          </div>
        </section>

        <section aria-labelledby="numbers" className="mx-auto max-w-5xl px-4 py-24 sm:px-6 sm:py-32">
          <h2 id="numbers" className="sr-only">Measured on real runs</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
            {STATS.map(([n, what], i) => (
              <Reveal key={what} delay={i * 60}>
                <dt className="tabular font-display text-5xl font-bold tracking-[-0.03em] sm:text-6xl">{n}</dt>
                <dd className="mt-2 max-w-[22ch] text-graphite">{what}</dd>
              </Reveal>
            ))}
          </dl>
          <p className="mt-16 flex flex-wrap justify-center gap-x-8 gap-y-3 text-lg">
            <Link href="/about" className="hit inline-flex items-center gap-1 text-scan-ink hover:underline">See how it works <Icon name="arrow" className="size-4" /></Link>
            <Link href="/jobs/sample" className="hit inline-flex items-center gap-1 text-scan-ink hover:underline">Open the example <Icon name="arrow" className="size-4" /></Link>
          </p>
        </section>
      </main>
      <HomeFooter />
    </div>
  );
}

const ago = (ms: number) => {
  const min = Math.round((Date.now() - ms) / 60000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};
/** Notes made in this browser in the last 24 hours (not the sample, which has its own link), one click from home. */
function RecentNotes() {
  const raw = useSyncExternalStore(subscribeRecent, readRecent, () => "[]");
  const list = useMemo(() => parseRecent(raw).filter((r) => r.id !== "sample").slice(0, 3), [raw]);
  if (!list.length) return null;
  return (
    <nav aria-label="Your recent notes" className="mt-6 flex flex-wrap items-center justify-center gap-2">
      <span className="text-sm text-graphite">Your notes</span>
      {list.map((r) => (
        <Link key={r.id} href={`/jobs/${r.id}`} title={r.title}
          className="flex min-h-9 max-w-[18rem] items-center gap-2 rounded-full bg-sheet px-3 text-sm ring-1 ring-rule transition-colors hover:ring-scan">
          <Icon name="check" className="size-3.5 text-proof" />
          <span className="truncate font-medium">{r.title}</span>
          <span className="shrink-0 text-xs text-graphite">{ago(r.at)}</span>
        </Link>
      ))}
      <Link href="/library" className="hit rounded-full px-2 py-1.5 text-sm text-scan-ink hover:underline">Library</Link>
    </nav>
  );
}

/** One input, the way you'd hand a task to an assistant: paste a link or add a file, then see the plan and the time. */
function Composer({ onDone }: { onDone: (body: Created) => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [unread, setUnread] = useState(false); // the browser can't read this format (AVI, WMV, .mts); the server checks it
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number; rate: number } | null>(null);
  const [checking, setChecking] = useState<number | null>(null); // performance.now() when the link check began
  const [now, setNow] = useState(0);
  const uploadStart = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const busy = progress !== null || checking !== null;
  // A submitted video leaves for its result page; the app keeps this page alive in the background, so clear it on
  // the way out. Otherwise coming back shows the old link still "opening" and the box won't take a new one.
  useEffect(() => () => {
    setChecking(null);
    setProgress(null);
    setText("");
    setFile(null);
    setMeta(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (checking === null) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [checking]);

  function choose(f: File | undefined) {
    setError(null);
    setMeta(null);
    setUnread(false);
    setText("");
    if (!f) return setFile(null);
    if (f.size > MAX_UPLOAD_MB * 2 ** 20) return setError(`That file is ${sizeLabel(f.size)}; the limit is ${sizeLabel(MAX_UPLOAD_MB * 2 ** 20)}.`);
    setFile(f);
    // Length and resolution from the file's own header: catches a too-long video early and sizes the estimate.
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      setMeta({ duration: v.duration, height: v.videoHeight });
      if (v.duration > MAX_MINUTES * 60) setError(`This video is ${(v.duration / 3600).toFixed(1)} hours long; the limit is ${MAX_MINUTES / 60} hours.`);
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      setUnread(true);
      URL.revokeObjectURL(url);
    };
    v.src = url;
  }

  // Paste a link anywhere on the page (not into another field) to start with it.
  const onPaste = useEffectEvent((t: string) => {
    if (busy || file || !isLink(t)) return;
    setText(t.trim());
    setError(null);
  });
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) return;
      const t = e.clipboardData?.getData("text") ?? "";
      if (isLink(t)) {
        e.preventDefault();
        onPaste(t);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);

  // Drop a video anywhere on the page, not only on a small target.
  const [dragging, setDragging] = useState(false);
  const onDrop = useEffectEvent((f: File) => !busy && choose(f));
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => !e.relatedTarget && setDragging(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer?.files[0]) onDrop(e.dataTransfer.files[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  function upload() {
    if (!file) return;
    setProgress({ loaded: 0, total: file.size, rate: 0 });
    // XHR rather than fetch: fetch has no upload progress events.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/jobs`);
    uploadStart.current = performance.now();
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const secs = (performance.now() - uploadStart.current) / 1000;
      setProgress({ loaded: ev.loaded, total: ev.total, rate: secs > 0.3 ? ev.loaded / secs : 0 });
    };
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || "{}");
      if (xhr.status === 201) return onDone(body);
      setProgress(null);
      setError(body.detail ?? `Upload failed (${xhr.status}).`);
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Could not reach the VidMind API. Check that it is running on port 8000.");
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  }

  async function checkLink(started: number) {
    setChecking(started);
    setNow(started);
    try {
      const res = await fetch(`${API_URL}/jobs/from-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: text.trim(), rights_confirmed: true }), // the button says what clicking confirms
        signal: AbortSignal.timeout(90_000),
      });
      const body = await res.json();
      if (res.status === 201) return onDone(body);
      setError(typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).`);
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "Checking the link took over 90 seconds. Try again."
          : "Could not reach the VidMind API. Check that it is running on port 8000.",
      );
    }
    setChecking(null);
  }

  const link = !file && isLink(text);
  const host = link ? new URL(text.trim()).hostname.replace(/^www\./, "") : "";
  const plan = file && meta ? estimate({ duration: meta.duration, height: meta.height }) : null;
  const share = progress ? progress.loaded / progress.total : 0;
  const uploadLeft = progress?.rate ? (progress.total - progress.loaded) / progress.rate : null;
  const ready = file ? !error && (!!meta || unread) : link;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || busy) return;
        setError(null);
        if (file) upload();
        else void checkLink(performance.now());
      }}
      className="space-y-4"
    >
      <div className={`glass rounded-[1.75rem] p-1.5 ring-1 transition-shadow focus-within:ring-2 focus-within:ring-scan sm:rounded-full ${busy ? "scanning ring-scan" : "ring-rule"}`}>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={busy}
            className="min-h-11 shrink-0 rounded-full px-4 font-medium text-scan-ink transition-colors hover:bg-scan-soft disabled:opacity-50"
          >
            Add a file
          </button>
          <input
            ref={picker}
            type="file"
            accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.wmv,.flv,.3gp,.mpg,.mpeg,.ts,.mts,.m2ts"
            onChange={(e) => choose(e.target.files?.[0])}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
          />
          {file ? (
            <p className="order-first min-w-0 basis-full truncate px-2 font-display text-lg font-semibold sm:order-none sm:basis-auto sm:flex-1" title={file.name}>
              {file.name}
            </p>
          ) : (
            <>
              <label htmlFor="source" className="sr-only">
                Video link
              </label>
              <input
                id="source"
                name="source"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                disabled={busy}
                placeholder="Paste a YouTube or Vimeo link…"
                className="order-first min-h-11 min-w-0 basis-full bg-transparent px-2 text-lg placeholder:text-graphite focus:outline-none sm:order-none sm:basis-auto sm:flex-1"
              />
            </>
          )}
          {file && !busy && (
            <button type="button" onClick={() => choose(undefined)} className="min-h-11 shrink-0 rounded-full px-3 text-sm text-graphite hover:text-ink">
              Remove
            </button>
          )}
          <Button type="submit" disabled={!ready || busy} working={busy} className="ml-auto shrink-0">
            {progress ? (share < 1 ? `Uploading ${Math.round(share * 100)}%` : "Checking the file…") : checking !== null ? "Opening the video…" : link ? "I have the rights — make notes" : "Make notes"}
          </Button>
        </div>
        {progress && (
          <div className="mx-4 mt-2 mb-1 h-1 overflow-hidden rounded-full bg-lightbox" role="progressbar" aria-label="Upload progress" aria-valuenow={Math.round(share * 100)}>
            <div className="lane-fill h-full rounded-full bg-scan" style={{ width: `${share * 100}%` }} />
          </div>
        )}
      </div>

      {file && (
        <div className="arrive space-y-3 rounded-2xl bg-sheet p-5 ring-1 ring-rule" aria-live="polite">
          <p className="flex flex-wrap gap-1.5">
            <Chip>{sizeLabel(file.size)}</Chip>
            {meta && <Chip>{formatTime(meta.duration)} long</Chip>}
            {meta?.height ? <Chip>{meta.height}p</Chip> : null}
            {!meta && !unread && !error && <Chip tone="scan">Reading the file…</Chip>}
          </p>
          {plan && !error && (
            <>
              <p className="font-display text-xl font-semibold">
                About {formatSeconds(plan.total)} to make notes{progress ? "" : ", once it's uploaded"}
              </p>
              <p className="flex flex-wrap gap-1.5">
                <Chip>listening ~{formatSeconds(plan.transcript)}</Chip>
                <Chip>keyframes and screen text ~{formatSeconds(plan.frames)}</Chip>
                <Chip>notes and checks ~{formatSeconds(plan.notes)}</Chip>
              </p>
              {meta && meta.height >= 1440 && <p className="text-sm text-wait">High-resolution video takes longer to scan for slide changes.</p>}
            </>
          )}
          {progress && share < 1 && (
            <p className="tabular text-sm text-graphite">
              Uploading at {progress.rate ? `${(progress.rate / 2 ** 20).toFixed(1)} MB/s` : "…"}
              {uploadLeft !== null && `, about ${formatSeconds(uploadLeft)} left`}
            </p>
          )}
        </div>
      )}

      {link && (
        <div className="arrive space-y-3 rounded-2xl bg-sheet p-5 ring-1 ring-rule">
          <p className="text-sm">By continuing, you confirm you own it or it&apos;s openly licensed.</p>
          <p className="tabular text-sm text-graphite" aria-live="polite">
            {checking !== null
              ? `Opening it on ${host}, ${formatSeconds((now - checking) / 1000)}`
              : `${host === "youtube.com" || host === "youtu.be" ? "Streams in, nothing downloaded. " : ""}5 minutes of video: about ${formatSeconds(typicalYoutube)}.`}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-strike">
          {error}
        </p>
      )}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-lightbox/70 backdrop-blur-sm" aria-hidden>
          <p className="rounded-3xl border-2 border-dashed border-scan bg-sheet px-10 py-8 font-display text-2xl font-semibold">
            Drop to add your video
          </p>
        </div>
      )}
      {!file && !link && (
        <p className="text-center text-sm text-balance text-graphite">
          Up to {MAX_MINUTES / 60} hours or {sizeLabel(MAX_UPLOAD_MB * 2 ** 20)}. Files or YouTube, Vimeo and direct links. Deleted after 24 hours.{" "}
          <Link href="/jobs/sample" className="hit text-scan-ink hover:underline">Or open the sample</Link>.
        </p>
      )}
    </form>
  );
}
