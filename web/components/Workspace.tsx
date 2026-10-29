"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
      {/* The scroll edge: content softens as it slides under the floating bar, instead of a hard line. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-10 h-36 bg-gradient-to-b from-lightbox from-55% to-transparent print:hidden" />
      {/* The navigation layer floats in glass; everything below it is solid content. */}
      <header className="sticky top-0 z-20 px-3 pt-3 sm:px-6">
        <div className="glass mx-auto flex h-13 max-w-5xl items-center gap-3 rounded-full pr-2 pl-4">
          <Logo size={24} />
          <ShellTitle title={title} />
          {!view.events.length && <Status job={job} />}
          {!replaying && job?.status === "done" && result && <CopyMd result={result} />}
          {result && jobId !== "sample" && !job?.shared && (
            <button onClick={deleteJob} className="hit rounded-full px-2 text-sm text-graphite hover:text-strike">
              Delete
            </button>
          )}
          <ThemeSwitch />
        </div>
        <Segmented tabs={tabs} tab={tab} onPick={setTab} />
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-8 sm:pt-14">
        {result?.source === "precomputed" && (
          <p className="mx-auto mb-8 w-fit rounded-full bg-scan-soft px-4 py-1.5 text-sm text-scan-ink">Precomputed sample. Not generated live.</p>
        )}
        {error && (
          <p role="alert" className="mb-6 rounded-2xl bg-strike-soft px-4 py-3 text-sm text-strike">
            {result ? "Stopped early: " : ""}
            {error}
          </p>
        )}

        {tab === "notes" && (
          <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-20">
            <Contents result={result} view={view} />
            <article className="mx-auto w-full max-w-[68ch] min-w-0 font-serif text-[1.1875rem] leading-[1.6] sm:text-[1.25rem] lg:mx-0">
              {running && <div className="mb-10 font-sans text-base">{run}</div>}
              <h1 className="font-display text-[2.25rem] leading-[1.06] font-bold tracking-[-0.03em] text-balance sm:text-[3.5rem]">{title}</h1>
              {tldr && <p className="arrive mt-6 font-display text-[1.25rem] leading-[1.45] tracking-[-0.01em] text-graphite sm:text-[1.375rem]">{tldr}</p>}
              <div className="mt-14 space-y-16">
                {result && !replaying && <Highlights result={result} seek={seek} />}
                <Notes result={result} view={view} base={base} seek={seek} now={now} job={job} replaying={replaying} fresh={celebrate} />
              </div>
              {result && !result.pending && !replaying && (
                // The cheapest proof the check is real: what it threw out, and why.
                <details className="group/d mt-20 border-t border-rule pt-6 font-sans text-base">
                  <summary className="hit flex cursor-pointer list-none items-center gap-3 font-display text-[1.0625rem] font-semibold [&::-webkit-details-marker]:hidden">
                    <span className="flex-1">
                      {result.rejected?.length
                        ? `${result.rejected.length} claim${result.rejected.length === 1 ? "" : "s"} removed: the video didn't support ${result.rejected.length === 1 ? "it" : "them"}`
                        : `All ${result.notes_checked ?? ""} claims checked. None removed.`}
                    </span>
                    <Chevron />
                  </summary>
                  {result.rejected?.length ? (
                    <ul className="mt-4 divide-y divide-rule">
                      {result.rejected.map((r, i) => (
                        <li key={i} className="py-3">
                          <p className="text-graphite line-through decoration-strike/60">{r.text}</p>
                          <p className="mt-1 text-sm text-strike">{r.reasons.join("; ")}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-graphite">Each quote was found in the transcript within seconds of where it says, and each screen citation is a real keyframe.</p>
                  )}
                </details>
              )}
              {result?.card_url && !replaying && (
                <section aria-labelledby="share-card" className="mt-16 font-sans">
                  <h2 id="share-card" className="font-display text-[1.75rem] font-bold tracking-[-0.02em]">Share this summary</h2>
                  <div className="mt-5 max-w-sm">
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

const Chevron = () => (
  <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0 text-graphite transition-transform group-open/d:rotate-90 motion-reduce:transition-none">
    <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The video's title joins the bar once the large title has scrolled away, like an iOS navigation bar. */
function ShellTitle({ title }: { title: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = () => setShown(scrollY > 220);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  return (
    <p aria-hidden={!shown} className={`min-w-0 flex-1 truncate text-center font-display text-[0.9375rem] font-semibold tracking-[-0.01em] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}>
      {title}
    </p>
  );
}

/** Tabs as a segmented control: a solid capsule glides under the chosen tab on a spring. */
function Segmented({ tabs, tab, onPick }: { tabs: [Tab, string, number | null][]; tab: Tab; onPick: (t: Tab) => void }) {
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = refs.current[tab];
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, [tab, tabs.map((t) => t[2]).join()]); // eslint-disable-line react-hooks/exhaustive-deps -- re-measure when a count changes the widths
  return (
    <div role="tablist" aria-label="Views" className="glass relative mx-auto mt-2 flex w-fit max-w-full rounded-full p-1">
      {pill && (
        <span aria-hidden className="absolute top-1 bottom-1 left-0 rounded-full bg-sheet shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-[translate,width] duration-500 ease-spring motion-reduce:transition-none" style={{ translate: `${pill.x}px`, width: pill.w }} />
      )}
      {tabs.map(([key, label, count]) => (
        <button
          key={key}
          ref={(el) => { refs.current[key] = el; }}
          role="tab"
          aria-selected={tab === key}
          onClick={() => onPick(key)}
          className={`relative min-h-9 shrink-0 rounded-full px-3.5 text-[0.875rem] font-medium whitespace-nowrap transition-colors sm:px-5 ${tab === key ? "text-ink" : "text-graphite hover:text-ink"}`}
        >
          {label}
          {count ? <span className="tabular ml-1.5 text-graphite">{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Chapters to jump to: a plain list beside the article on wide screens, the one being read in the tint; a "Contents" disclosure on phones. */
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
    <ol className="space-y-1">
      {items.map((c) => (
        <li key={c.id}>
          <a
            href={`#${c.id}`}
            onClick={(e) => jump(e, c.id)}
            aria-current={current === c.id ? "location" : undefined}
            className={`block rounded-md py-1 text-[0.875rem] leading-snug transition-colors ${current === c.id ? "font-semibold text-scan-ink" : "text-graphite hover:text-ink"}`}
          >
            {c.label}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <nav aria-label="Contents" className="sticky top-36 hidden max-h-[calc(100vh-10rem)] self-start overflow-y-auto pt-3 lg:block">
        <p className="mb-3 text-xs font-semibold tracking-wide text-graphite uppercase">Contents</p>
        {list}
      </nav>
      <details className="group/d mx-auto mb-10 max-w-[68ch] border-b border-rule pb-3 lg:hidden">
        <summary className="hit flex cursor-pointer list-none items-center justify-between font-display font-semibold [&::-webkit-details-marker]:hidden">
          Contents <Chevron />
        </summary>
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
        <p className="scanning rounded-2xl bg-sheet p-5 font-sans text-base text-graphite">
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
    <Button variant="quiet" onClick={copy} aria-live="polite" className="min-h-9 shrink-0 px-3.5 py-1.5 text-sm max-sm:px-3">
      {copied ? "Copied" : <span>Copy<span className="max-sm:hidden"> as Markdown</span></span>}
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

