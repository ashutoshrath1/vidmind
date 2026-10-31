"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import Reveal from "@/components/Reveal";
import { RunChart } from "@/components/Timeline";
import { formatSeconds } from "@/lib/api";
import { MODEL_API, MODEL_BRAND, MODEL_CARDS, MODEL_FAMILY } from "@/lib/site";
import type { TraceEvent } from "@/lib/trace";

// Every number on this page was measured on a real run (see docs and the e2e tests); none is a placeholder.
const MINUTES_SAVED_PER_HOUR = 47; // a 5-minute lecture: reading the notes vs watching

export const STATS: [string, string][] = [
  ["4.5 s", "a 10-minute YouTube talk to checked notes"],
  ["100%", "of notes backed by the video, in the sample"],
  [`${MINUTES_SAVED_PER_HOUR} min`, "saved per hour of video"],
  ["4", `${MODEL_FAMILY} on every video`],
];

const FEATURES: { icon: IconName; title: string; text: string; image: string; w: number; h: number; wide?: boolean }[] = [
  { icon: "check", title: "Notes with proof", text: "Every point links to the second it was said or shown.", image: "notes", w: 1200, h: 933, wide: true },
  { icon: "diagram", title: "The diagram it explains", text: "Drawn from what the video says and shows.", image: "diagram", w: 1200, h: 406 },
];

/** A feature: one line of type over a real capture of the app. */
function Tile({ f }: { f: (typeof FEATURES)[number] }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl bg-sheet ring-1 ring-rule">
      <div className="p-8 pb-6 sm:p-10 sm:pb-8">
        <h3 className="font-display text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{f.title}</h3>
        <p className="mt-2 text-lg text-graphite">{f.text}</p>
      </div>
      <div className="mt-auto px-8 sm:px-10">
        {/* eslint-disable-next-line @next/next/no-img-element -- static product captures, already WebP and sized */}
        <img src={`/landing/${f.image}.webp`} alt={`${f.title}: a real VidMind result`} width={f.w} height={f.h} loading="lazy"
          className="max-h-96 w-full rounded-t-xl object-cover object-top ring-1 ring-rule" />
      </div>
    </article>
  );
}

/** The sample's real run, replayed by scrolling: the further down, the further into the run. */
function RunReplay() {
  const box = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    fetch("/landing/trace.jsonl").then((r) => r.text())
      .then((t) => setEvents(t.split("\n").filter(Boolean).map((l) => JSON.parse(l))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; // the finished run, no scrubbing
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = box.current?.getBoundingClientRect();
      if (reduced) setProgress(1);
      else if (r) setProgress(Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height * 0.9))));
    };
    const onScroll = () => (raf ||= requestAnimationFrame(update));
    raf = requestAnimationFrame(update);
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  const end = events.findLast((e) => e.kind === "done")?.t ?? 1;
  const now = progress * end;
  if (!events.length) return null;
  return (
    <div ref={box} className="space-y-3">
      <RunChart events={events.filter((e) => e.t <= now)} now={now} running={progress < 1} />
      <p className="tabular text-center text-sm text-graphite">
        {formatSeconds(now)} of {formatSeconds(end)}: the sample&apos;s real run, replayed as you scroll
      </p>
    </div>
  );
}

const MEASURED: [string, string][] = [
  ["4.5 s", "A 10-minute YouTube talk, start to checked notes (4 runs: 4.2-5.1 s; was 16.9 s)"],
  ["19 / 19", "Notes on the sample that passed the evidence check against the transcript and keyframes"],
  ["0", "Notes shown without proof: anything the video can't back is thrown out, with the reason"],
];

const FAQ: [string, string][] = [
  ["What happens to my video?", `It's processed on this server and deleted after 24 hours. The video, its transcript and screen text go to ${MODEL_API} to write the notes.`],
  ["How is a note “proven”?", "Every quote must match the transcript within seconds of when it was said, and every on-screen citation must match a real frame. Notes that fail are fixed once or thrown out, and the page shows what was thrown out and why."],
  ["What can it read?", "Uploads up to 12 hours and 2 GB (MP4, MOV, WebM, MKV), or YouTube, Vimeo and direct links. Paid and copy-protected courses aren't supported."],
];

const H2 = "font-display text-4xl leading-[1.08] font-bold tracking-[-0.03em] text-balance sm:text-6xl";
const SECTION = "mx-auto max-w-5xl px-4 py-24 sm:px-6 sm:py-32";

/** The long story, one idea per section, like a product page. */
export default function Landing() {
  const [hours, setHours] = useState(5);
  const saved = hours * MINUTES_SAVED_PER_HOUR;
  return (
    <>
      <section className="mx-auto max-w-5xl px-4 pt-20 pb-8 text-center sm:px-6 sm:pt-28">
        <h1 className="font-display text-5xl leading-[1.04] font-bold tracking-[-0.03em] text-balance sm:text-7xl lg:text-8xl">How VidMind works.</h1>
        <p className="mx-auto mt-5 max-w-[42ch] text-xl text-graphite">It hears the words, reads the screen, and keeps only the notes the video can back.</p>
      </section>

      <section aria-labelledby="trick" className={SECTION}>
        <Reveal className="text-center">
          <h2 id="trick" className={`${H2} mx-auto max-w-[20ch]`}>A summary hears the words. VidMind also reads the screen.</h2>
          <p className="mx-auto mt-5 max-w-[48ch] text-xl text-graphite">In our sample video the retention target, 40%, is only on a slide. Nobody says it.</p>
        </Reveal>
        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <Reveal className="h-full">
            <div className="h-full rounded-3xl bg-sheet p-8 ring-1 ring-rule sm:p-10">
              <p className="text-sm font-semibold text-graphite">A transcript-only summary</p>
              <p className="mt-4 font-serif text-2xl leading-snug">“The team discussed week-1 retention and how it&apos;s measured.”</p>
              <p className="mt-4 text-strike">The number is missing: it was never spoken.</p>
            </div>
          </Reveal>
          <Reveal delay={100} className="h-full">
            <div className="h-full rounded-3xl bg-sheet p-8 ring-2 ring-proof sm:p-10">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-proof"><Icon name="check" /> VidMind</p>
              <p className="mt-4 font-serif text-2xl leading-snug">“The week-1 retention target is 40%.”</p>
              <p className="mt-4 flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-proof-soft px-3 py-1 text-proof">Seen on screen at 0:30</span>
                <span className="rounded-full bg-scan-soft px-3 py-1 text-scan-ink">Never said aloud</span>
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="features" aria-labelledby="features-title" className={`${SECTION} scroll-mt-16`}>
        <Reveal className="text-center">
          <h2 id="features-title" className={H2}>One video in.<br />Everything you need out.</h2>
          <p className="mx-auto mt-5 max-w-[48ch] text-xl text-graphite">Every image here is a real result, captured from the app.</p>
        </Reveal>
        <div className="mt-14 grid gap-5 lg:grid-cols-5">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 80} className={f.wide ? "lg:col-span-3" : "lg:col-span-2"}>
              <Tile f={f} />
            </Reveal>
          ))}
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className={`${SECTION} scroll-mt-16`}>
        <Reveal className="text-center">
          <h2 id="how-title" className={H2}>Every model. Every second.</h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-xl text-graphite">Speech, keyframes, diagrams and notes all run at once. Green bars won; hatched ones were backups.</p>
        </Reveal>
        <Reveal className="mt-14 rounded-3xl bg-sheet p-5 ring-1 ring-rule sm:p-8"><RunReplay /></Reveal>
      </section>

      <section aria-labelledby="models-title" className={SECTION}>
        <Reveal className="text-center"><h2 id="models-title" className={H2}>Built on {MODEL_BRAND}.</h2></Reveal>
        <ul className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {MODEL_CARDS.map((m, i) => (
            <li key={m.name}>
              <Reveal delay={i * 60}>
                <Icon name={m.icon} className="size-7 text-scan-ink" />
                <p className="mt-4 font-display text-xl font-semibold">{m.name}</p>
                <p className="mt-2 text-graphite">{m.does}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="measured-title" className={SECTION}>
        <Reveal className="text-center">
          <h2 id="measured-title" className={H2}>Measured, not claimed.</h2>
          <p className="mx-auto mt-5 text-xl text-graphite">From our test runs. These are not user reviews.</p>
        </Reveal>
        <dl className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-3">
          {MEASURED.map(([n, what], i) => (
            <Reveal key={what} delay={i * 60}>
              <dt className="tabular font-display text-6xl font-bold tracking-[-0.03em]">{n}</dt>
              <dd className="mt-3 text-graphite">{what}</dd>
            </Reveal>
          ))}
        </dl>
        <Reveal className="mt-16 rounded-3xl bg-sheet p-8 ring-1 ring-rule sm:p-10">
          <label htmlFor="hours" className="font-display text-xl font-semibold">How many hours of video do you watch a week?</label>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <input id="hours" type="range" min={1} max={20} value={hours} onChange={(e) => setHours(Number(e.target.value))}
              className="min-h-11 flex-1 accent-[var(--scan)]" aria-describedby="saved" />
            <span className="tabular w-16 text-right font-semibold">{hours} h</span>
          </div>
          <p id="saved" className="mt-4 text-lg" aria-live="polite">
            About <b className="tabular text-proof">{Math.floor(saved / 60)} h {saved % 60} min</b> back every week, at {MINUTES_SAVED_PER_HOUR} min saved per hour of video.
          </p>
        </Reveal>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-3xl scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32">
        <Reveal className="text-center"><h2 id="faq-title" className={H2}>Questions.</h2></Reveal>
        <div className="mt-12 divide-y divide-rule border-y border-rule">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group">
              <summary className="hit flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display text-lg font-semibold">
                {q}<span aria-hidden className="spring text-2xl font-normal text-graphite transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="pb-5 text-graphite">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pt-8 pb-32 text-center sm:px-6">
        <Reveal>
          <h2 className={H2}>Your next video,<br />checked in seconds.</h2>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            <Link href="/" className="spring inline-flex min-h-12 items-center rounded-full bg-scan px-7 text-lg font-medium text-on-scan transition-transform hover:scale-[1.03] active:scale-[0.98]">
              Make notes
            </Link>
            <Link href="/jobs/sample" className="hit inline-flex items-center gap-1 text-lg text-scan-ink hover:underline">See a finished example <Icon name="arrow" /></Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
