"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Highlights from "@/components/Highlights";
import Logo from "@/components/Logo";
import { useMiniPlayer } from "@/components/MiniPlayer";
import ThemeSwitch from "@/components/ThemeSwitch";
import { SummaryCard } from "@/components/SummaryCard";
import ProofSheet from "@/components/ProofSheet";
import { ChapterView, SectionLive, chapterId } from "@/components/Sections";
import RunPanel from "@/components/RunPanel";
import ScreenText from "@/components/ScreenText";
import Timeline from "@/components/Timeline";
import { Button, Chip, type Seek } from "@/components/ui";
import { type JobStatus, type LearnResult, jobUrl } from "@/lib/api";
import { toMarkdown } from "@/lib/export";
import type { View } from "@/lib/trace";

type Props = {
  jobId: string;
  at: number; // ?t=: the second the player opens at
  job: JobStatus | null;
  result: LearnResult | null;
  view: View;
  now: number; // seconds since the job was created (server clock)
  error?: string | null;
  replaying: boolean;
  celebrate: boolean;
  onReplay?: () => void;
};

type Tab = "notes" | "frames" | "trace";

export default function Workspace({ jobId, at, job, result, view, now, error, replaying, celebrate, onReplay }: Props) {
  const router = useRouter();
  const [picked, setTab] = useState<Tab | null>(null);
  const tabs: [Tab, string, number | null][] = [
    ["notes", "Notes", null],
    ["frames", "On screen", view.frames.length || null],
    ["trace", "How it was made", null],
  ];
  const tab = picked ?? "notes";
  const base = jobUrl(jobId);
  const running = replaying || (!!job && job.status !== "done" && job.status !== "failed");
  const youtubeId = result?.youtube_id ?? view.source?.youtube_id ?? null;
  const title = result?.title ?? view.overview.result?.title ?? view.ready?.title ?? job?.source_title ?? "Your video";
  const tldr = result?.tldr || view.overview.result?.tldr;
  // Uploads have the file at once; downloaded links once the download ends; YouTube plays from YouTube.
  const hasVideo = !!youtubeId || !!result || view.ready?.origin === "upload" || (!!view.stages.fetch?.end && !view.source?.streaming);
  const player = useMiniPlayer(youtubeId, base, title, at);
  const seek: Seek = (t) => hasVideo && player.seek(t);

  async function deleteJob() {
    if (!confirm("Delete this video, its notes and its frames from the server?")) return;
    await fetch(base, { method: "DELETE" });
    router.push("/");
  }

  const run = (view.events.length > 0 || running) && (
    <RunPanel view={view} now={now} running={running} replaying={replaying} celebrate={celebrate} onReplay={onReplay} />
  );

  return (
    <div className="page-enter flex-1">
      {/* Chrome is glass; the reading surface below it is solid. */}
      <header className="glass sticky top-0 z-20 border-b border-rule">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-2 sm:px-8">
          <Logo size={26} />
          <p className="min-w-0 flex-1 truncate text-sm text-graphite max-sm:invisible">{view.ready?.channel ?? ""}</p>
          {!view.events.length && <Status job={job} />}
          {!replaying && job?.status === "done" && result && <CopyMd result={result} />}
          {result && jobId !== "sample" && !job?.shared && (
            <button onClick={deleteJob} className="hit text-sm text-graphite underline underline-offset-4 hover:text-strike">
              Delete
            </button>
          )}
          <ThemeSwitch />
        </div>
        <div role="tablist" aria-label="Views" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 [scrollbar-width:none] sm:px-6">
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-3 py-2 font-display font-semibold transition ${tab === key ? "border-scan text-ink" : "border-transparent text-graphite hover:text-ink"}`}
            >
              {label}
              {count ? <span className="tabular ml-1.5 rounded-full bg-lightbox px-1.5 py-px align-middle font-sans text-[11px] text-graphite ring-1 ring-rule">{count}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        {result?.source === "precomputed" && (
          <p className="mb-6 rounded-lg bg-scan-soft px-4 py-2 text-sm text-scan-ink ring-1 ring-scan/20">Precomputed sample. Not generated live.</p>
        )}
        {error && (
          <p role="alert" className="mb-6 rounded-lg bg-strike-soft px-4 py-3 text-sm text-strike">
            {result ? "Stopped early: " : ""}
            {error}
          </p>
        )}

        {tab === "notes" && (
          <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
            <Contents result={result} view={view} />
            <article className="notes-body mx-auto w-full max-w-[70ch] min-w-0 lg:mx-0">
              {running && <div className="mb-8">{run}</div>}
              <h1 className="font-display text-[2rem] leading-[1.15] font-bold tracking-tight text-balance sm:text-[2.6rem]">{title}</h1>
              {tldr && <p className="arrive mt-5 text-[1.2rem] leading-[1.65] text-graphite">{tldr}</p>}
              <div className="mt-12 space-y-14">
                {result && !replaying && <Highlights result={result} seek={seek} />}
                <Notes result={result} view={view} base={base} seek={seek} now={now} job={job} replaying={replaying} fresh={celebrate} />
              </div>
              {result && !result.pending && !replaying && (
                // The cheapest proof the check is real: what it threw out, and why.
                <details className="mt-16 border-t border-rule pt-8 text-[1.05rem]">
                  <summary className="cursor-pointer font-display font-semibold">
                    {result.rejected?.length
                      ? `Removed: ${result.rejected.length} claim${result.rejected.length === 1 ? "" : "s"} the video didn't support`
                      : `Every one of the ${result.notes_checked ?? ""} claims was checked; none had to be removed`}
                  </summary>
                  {result.rejected?.length ? (
                    <ul className="mt-4 space-y-3">
                      {result.rejected.map((r, i) => (
                        <li key={i} className="border-l-2 border-strike/50 pl-3">
                          <p className="text-graphite line-through decoration-strike/60">{r.text}</p>
                          <p className="text-sm text-strike">{r.reasons.join("; ")}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-graphite">Each quote was found in the transcript within seconds of where it says, and each screen citation is a real keyframe.</p>
                  )}
                </details>
              )}
              {result?.card_url && !replaying && (
                <section aria-labelledby="share-card" className="mt-16 border-t border-rule pt-10">
                  <h2 id="share-card" className="font-display text-xl font-bold">Share this summary</h2>
                  <div className="mt-4 max-w-sm">
                    <SummaryCard result={result} base={base} />
                  </div>
                </section>
              )}
            </article>
          </div>
        )}
        {tab === "frames" && (
          <div className="space-y-6">
            <ProofSheet view={view} base={base} seek={seek} />
            <ScreenText view={view} base={base} seek={seek} />
          </div>
        )}
        {tab === "trace" && (
          <div className="space-y-6">
            {!running && run}
            <Timeline view={view} now={now} running={running} />
          </div>
        )}
      </div>
      {player.player}
    </div>
  );
}

/** Chapters to jump to: a plain list beside the article on wide screens, highlighting the one being read; a "Contents" disclosure on phones. */
function Contents({ result, view }: { result: LearnResult | null; view: View }) {
  const items = result?.chapters.length
    ? result.chapters.map((c) => ({ id: chapterId(c.start_seconds), label: c.title }))
    : view.sections.map((s) => ({ id: chapterId(s.lo), label: `Section ${s.i + 1}` }));
  const [current, setCurrent] = useState<string | null>(null);
  const ids = items.map((i) => i.id).join(" ");
  useEffect(() => {
    // The current chapter is the last one whose heading has passed the top third of the screen.
    const pick = () => {
      let on: string | null = null;
      for (const id of ids.split(" ")) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < innerHeight / 3) on = id;
      }
      setCurrent(on);
    };
    pick();
    addEventListener("scroll", pick, { passive: true });
    return () => removeEventListener("scroll", pick);
  }, [ids]);
  if (!items.length) return <div aria-hidden />;
  const jump = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const list = (
    <ol className="space-y-0.5 border-l border-rule">
      {items.map((c) => (
        <li key={c.id}>
          <a
            href={`#${c.id}`}
            onClick={(e) => jump(e, c.id)}
            aria-current={current === c.id ? "location" : undefined}
            className={`-ml-px block border-l-2 py-1.5 pl-4 text-[0.95rem] leading-snug transition-colors ${current === c.id ? "border-scan font-medium text-ink" : "border-transparent text-graphite hover:text-ink"}`}
          >
            {c.label}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <nav aria-label="Contents" className="sticky top-32 hidden max-h-[calc(100vh-9rem)] self-start overflow-y-auto lg:block">
        <p className="mb-3 font-display text-sm font-semibold">Contents</p>
        {list}
      </nav>
      <details className="mx-auto mb-8 max-w-[70ch] border-b border-rule pb-3 lg:hidden">
        <summary className="hit cursor-pointer font-display font-semibold">Contents</summary>
        <nav aria-label="Contents (compact)" className="pt-3">{list}</nav>
      </details>
    </>
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
      <div className="space-y-14">
        {chapters.map((ch, i) => (
          <ChapterView key={i} chapter={ch} seek={seek} />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-14">
      {view.sections.map((s) => {
        // Only once its section is done in the trace, so a replay rebuilds the chapters in the order they landed.
        const chapter = s.done && chapters.find((c) => Math.abs(c.start_seconds - s.lo) < 1);
        return chapter ? (
          <ChapterView key={s.i} chapter={chapter} seek={seek} fresh={fresh} />
        ) : (
          <SectionLive key={s.i} section={s} now={now} failed={!!s.done && !s.done.ok} base={base} seek={seek} />
        );
      })}
    </div>
  );
}

/** Take the notes with you, as Markdown. */
function CopyMd({ result }: { result: LearnResult }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(toMarkdown(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button variant="quiet" onClick={copy} aria-live="polite" className="min-h-9 px-3.5 py-1.5 text-sm">
      {copied ? "Copied" : "Copy .md"}
    </Button>
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

