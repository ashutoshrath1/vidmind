"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AskPanel from "@/components/AskPanel";
import Highlights from "@/components/Highlights";
import Logo from "@/components/Logo";
import ThemeSwitch from "@/components/ThemeSwitch";
import ModelsUsed from "@/components/ModelsUsed";
import { SummaryCard } from "@/components/ModeOutput";
import ProofSheet from "@/components/ProofSheet";
import { ChapterView, SectionLive, chapterId } from "@/components/Sections";
import RunPanel from "@/components/RunPanel";
import ScreenText from "@/components/ScreenText";
import Study from "@/components/Study";
import Timeline from "@/components/Timeline";
import { Button, Chip, type Seek, YT_ORIGIN, usePlayer } from "@/components/ui";
import { type JobStatus, type LearnResult, formatTime, jobUrl } from "@/lib/api";
import { toMarkdown } from "@/lib/export";
import type { View } from "@/lib/trace";

type Props = {
  jobId: string;
  at: number; // ?t=: the second the video opens at
  job: JobStatus | null;
  result: LearnResult | null;
  view: View;
  now: number; // seconds since the job was created (server clock)
  error?: string | null;
  replaying: boolean;
  celebrate: boolean;
  onReplay?: () => void;
};

type Tab = "notes" | "study" | "frames" | "ask" | "trace";

export default function Workspace({ jobId, at, job, result, view, now, error, replaying, celebrate, onReplay }: Props) {
  const router = useRouter();
  const [picked, setTab] = useState<Tab | null>(null);
  const tabs: [Tab, string, number | null][] = [
    ["notes", "Notes", null],
    // Flashcards are written from the finished notes and takeaways, so the tab waits for them.
    ...(result && !result.pending && result.chapters.some((c) => c.notes.length) ? [["study", "Study", null] as [Tab, string, null]] : []),
    ["frames", "Keyframes", view.frames.length || null],
    ["ask", "Ask the video", null],
    ["trace", "Behind the scenes", null],
  ];
  const tab = picked ?? "notes";
  const base = jobUrl(jobId);
  const running = replaying || (!!job && job.status !== "done" && job.status !== "failed");
  const youtubeId = result?.youtube_id ?? view.source?.youtube_id ?? null;
  const title = result?.title ?? view.overview.result?.title ?? view.ready?.title ?? job?.source_title ?? "Your video";
  const { video, yt, seek } = usePlayer(youtubeId);

  async function deleteJob() {
    if (!confirm("Delete this video, its notes and its frames from the server?")) return;
    await fetch(base, { method: "DELETE" });
    router.push("/");
  }

  // Uploads have the file at once; downloaded links once the download ends; YouTube plays from YouTube.
  const hasVideo = !!result || view.ready?.origin === "upload" || (!!view.stages.fetch?.end && !view.source?.streaming);

  return (
    <div className="page-enter flex-1">
      <header className="z-20 border-b border-rule bg-lightbox/90 backdrop-blur lg:sticky lg:top-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
          <Logo size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display font-semibold">{title}</p>
            {view.ready?.channel && <p className="truncate text-xs text-graphite">{view.ready.channel}</p>}
          </div>
          {!view.events.length && <Status job={job} />}
          <ThemeSwitch />
        </div>
      </header>

      {(view.events.length > 0 || running) && (
        <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-8">
          <RunPanel view={view} now={now} running={running} replaying={replaying} celebrate={celebrate} onReplay={onReplay} />
        </div>
      )}

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-label="Video and evidence" className="space-y-4 lg:self-start">
          {result?.source === "precomputed" && (
            <p className="rounded-lg bg-scan-soft px-4 py-3 text-sm text-scan-ink ring-1 ring-scan/20">Precomputed sample. Not generated live.</p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-strike-soft px-4 py-3 text-sm text-strike">
              {result ? "Stopped early: " : ""}
              {error}
            </p>
          )}
          {youtubeId ? (
            <iframe
              ref={yt}
              src={`${YT_ORIGIN}/embed/${youtubeId}?enablejsapi=1&rel=0${at ? `&start=${at}` : ""}`}
              title={title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              className="aspect-video w-full rounded-lg bg-black"
            />
          ) : hasVideo ? (
            <video ref={video} src={`${base}/video${at ? `#t=${at}` : ""}`} controls preload="metadata" className="aspect-video w-full rounded-lg bg-black" />
          ) : (
            <div className="scanning aspect-video w-full rounded-lg bg-black/85" aria-label="Opening the video" />
          )}
          <Fold title="Models in this video" open><ModelsUsed view={view} /></Fold>
          {result?.card_url && <Fold title="Summary card" open><SummaryCard result={result} base={base} /></Fold>}
          {result && jobId !== "sample" && !job?.shared && (
            <p className="text-xs text-graphite">
              <button onClick={deleteJob} className="hit underline underline-offset-4 hover:text-strike">
                Delete this video from the server
              </button>
            </p>
          )}
        </section>

        <section aria-label="Notes, quiz and questions" className="min-w-0">
          {(result?.tldr || view.overview.result?.tldr) && (
            <div className="arrive mb-6 border-l-4 border-scan pl-4">
              <h2 className="font-display text-sm font-semibold text-scan-ink">In short</h2>
              <Clamp text={(result?.tldr || view.overview.result?.tldr) ?? ""} />
            </div>
          )}
          <div role="tablist" aria-label="Views" className="mb-6 flex gap-1 overflow-x-auto border-b border-rule bg-lightbox/95 backdrop-blur [scrollbar-width:none]">
            {tabs.map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-px min-h-11 shrink-0 border-b-2 px-3 py-2.5 font-display font-semibold transition sm:px-4 ${tab === key ? "border-scan text-ink" : "border-transparent text-graphite hover:text-ink"}`}
              >
                {label}
                {count ? <span className="tabular ml-1.5 rounded-full bg-lightbox px-1.5 py-px align-middle font-sans text-[11px] text-graphite ring-1 ring-rule">{count}</span> : null}
              </button>
            ))}
          </div>

          {tab === "notes" && result && !replaying && <Highlights result={result} base={base} seek={seek} />}
          {tab === "notes" && <Notes result={result} view={view} base={base} seek={seek} now={now} job={job} replaying={replaying} fresh={celebrate} />}
          {tab === "study" && result && <Study jobId={jobId} base={base} seek={seek} youtubeId={youtubeId} title={title} />}
          {tab === "frames" && (
            <div className="space-y-6">
              <ProofSheet view={view} base={base} seek={seek} />
              <ScreenText view={view} base={base} seek={seek} />
            </div>
          )}
          {tab === "ask" && (
            <AskPanel base={base} seek={seek} ready={!running && !!result} view={view} questions={result?.questions ?? []} keyTerms={result?.chapters.flatMap((c) => c.key_terms) ?? []} />
          )}
          {tab === "trace" && <Timeline view={view} now={now} running={running} />}
        </section>
      </div>
    </div>
  );
}

/** A collapsible block in the left column. */
function Fold({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group">
      <summary className="hit flex cursor-pointer items-center justify-between rounded-lg px-1 py-1.5 font-display text-sm font-semibold hover:text-scan-ink">
        {title}
        <span aria-hidden className="text-graphite transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="arrive mt-1">{children}</div>
    </details>
  );
}

/** The summary at three lines, with a toggle for the rest. */
function Clamp({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  return (
    <p className="mt-1 max-w-[70ch] text-lg leading-relaxed">
      <span className={more ? "" : "line-clamp-3"}>{text}</span>
      {text.length > 220 && (
        <button type="button" onClick={() => setMore((m) => !m)} className="hit text-sm text-scan-ink underline underline-offset-4">
          {more ? "less" : "more"}
        </button>
      )}
    </p>
  );
}

/** Results made before the trace existed have no run panel; they still get a status. */
function Status({ job }: { job: JobStatus | null }) {
  if (!job) return <span className="text-sm text-graphite">Connecting</span>;
  if (job.status === "done") return <Chip tone="proof">Finished</Chip>;
  if (job.status === "failed") return <Chip tone="strike">Stopped</Chip>;
  return <span className="text-sm text-graphite">Working</span>;
}

type NotesProps = {
  result: LearnResult | null;
  view: View;
  base: string;
  seek: Seek;
  now: number;
  job: JobStatus | null;
  replaying: boolean;
  fresh: boolean;
};

function Notes({ result, view, base, seek, now, job, replaying, fresh }: NotesProps) {
  const chapters = result?.chapters ?? [];
  // Live: one slot per planned section, which becomes its chapter when it lands. Older results have no plan.
  if (!view.sections.length) {
    if (!chapters.length || replaying)
      return (
        <p className="scanning rounded-lg bg-sheet p-5 text-graphite ring-1 ring-rule">
          {job?.status === "queued" ? "Waiting for a free worker" : "Opening the video"}
        </p>
      );
    return (
      <div className="space-y-12">
        {chapters.map((ch, i) => (
          <ChapterView key={i} chapter={ch} base={base} seek={seek} />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-12">
      {!replaying && job?.status === "done" && result && <NotesBar result={result} />}
      {view.sections.map((s) => {
        // Only once its section is done in the trace, so a replay rebuilds the chapters in the order they landed.
        const chapter = s.done && chapters.find((c) => Math.abs(c.start_seconds - s.lo) < 1);
        return chapter ? (
          <ChapterView key={s.i} chapter={chapter} base={base} seek={seek} section={s} fresh={fresh} />
        ) : (
          <SectionLive key={s.i} section={s} now={now} failed={!!s.done && !s.done.ok} />
        );
      })}
    </div>
  );
}

/** Jump between chapters, and take the notes with you. Sticky, so both stay in reach while reading. */
function NotesBar({ result }: { result: LearnResult }) {
  const [copied, setCopied] = useState(false);
  const jump = (start: number) =>
    document.getElementById(chapterId(start))?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });

  async function copy() {
    await navigator.clipboard.writeText(toMarkdown(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-2 bg-lightbox/95 px-2 py-2 backdrop-blur lg:top-[4.25rem]">
      <nav aria-label="Chapters" className="flex min-w-0 basis-full gap-1.5 overflow-x-auto [scrollbar-width:none] sm:basis-auto sm:flex-1">
        {result.chapters.map((c) => (
          <button
            key={c.start_seconds}
            onClick={() => jump(c.start_seconds)}
            className="min-h-11 max-w-56 shrink-0 truncate rounded-full bg-sheet px-3 text-sm ring-1 ring-rule hover:ring-scan"
          >
            <span className="tabular mr-1.5 font-mono text-xs text-scan-ink">{formatTime(c.start_seconds)}</span>
            {c.title}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex shrink-0 gap-2">
        <Button variant="quiet" onClick={copy} aria-live="polite">
          {copied ? "Copied" : "Copy .md"}
        </Button>
      </div>
    </div>
  );
}

/** Expired after 24 hours, deleted, or a mistyped link: say so plainly and offer the way forward. */
export function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10 sm:px-8">
      <Logo />
      <div className="space-y-4 pt-10">
        <h1 className="font-display text-2xl font-bold">These notes aren&apos;t here any more</h1>
        <p className="text-lg leading-relaxed text-graphite">
          Notes are deleted after 24 hours, or the link is mistyped. Add the video again for fresh notes in seconds.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-full bg-scan px-5 font-display font-semibold text-on-scan hover:brightness-110">
          Add a video
        </Link>
        <Link href="/jobs/sample" className="inline-flex min-h-11 items-center rounded-full bg-sheet px-5 font-display font-semibold ring-1 ring-rule hover:ring-graphite">
          See the sample
        </Link>
      </div>
    </main>
  );
}

