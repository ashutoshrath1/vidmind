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
import { ChapterView, SectionLive } from "@/components/Sections";
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
          {/* The heading belongs to the article; the other tabs keep the bar clear. */}
          {tab === "notes" ? <ShellTitle title={title} /> : <span className="flex-1" />}
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
          <div>
            <article className="mx-auto w-full max-w-[68ch] min-w-0 font-serif text-[1.1875rem] leading-[1.6] sm:text-[1.25rem]">
              {running && <div className="mb-10 font-sans text-base">{run}</div>}
              <h1 className="font-display text-[1.75rem] leading-[1.2] font-bold tracking-[-0.02em] text-balance sm:text-[2rem]">{title}</h1>
              <ArticleMeta result={result} channel={view.ready?.channel} />
              <div className="mt-10 space-y-16">
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

/** Once the title has scrolled away the bar names where you are: the video, then each chapter's heading as you reach it. */
function ShellTitle({ title }: { title: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const on = () => {
      let at: string | null = scrollY > 160 ? title : null;
      // The current chapter is the last one whose top has passed under the bar.
      for (const el of document.querySelectorAll<HTMLElement>('[id^="chapter-"]'))
        if (el.getBoundingClientRect().top < 140) at = el.querySelector("h2")?.textContent ?? at;
      setLabel(at);
    };
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, [title]);
  return (
    <p aria-live="polite" className="min-w-0 flex-1 truncate text-center font-display text-[0.9375rem] font-semibold tracking-[-0.01em]">
      {/* Keyed so each new heading fades in (the arrive animation is still under reduced motion). */}
      {label && <span key={label} className="arrive">{label}</span>}
    </p>
  );
}

/** One quiet line under the title, like a blog byline: length, how many notes were checked, the channel. */
function ArticleMeta({ result, channel }: { result: LearnResult | null; channel?: string | null }) {
  if (!result) return null;
  const notes = result.chapters.reduce((n, c) => n + c.notes.length, 0);
  const unsure = result.chapters.reduce((n, c) => n + c.notes.filter((x) => x.uncertain).length, 0);
  const parts = [
    result.duration_seconds ? `${Math.max(1, Math.round(result.duration_seconds / 60))} min video` : null,
    notes ? `${notes} notes checked against the video${unsure ? `, ${unsure} marked unsure` : ""}` : null,
    channel,
  ].filter(Boolean);
  return <p className="mt-3 font-sans text-[0.9375rem] text-graphite">{parts.join(" · ")}</p>;
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
          <ChapterView key={i} chapter={ch} seek={seek} base={base} pending={result?.pending} />
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
          <ChapterView key={s.i} chapter={chapter} seek={seek} base={base} pending={result?.pending} fresh={fresh} />
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

