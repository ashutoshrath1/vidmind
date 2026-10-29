"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { RunChart } from "@/components/Timeline";
import { formatSeconds } from "@/lib/api";
import type { TraceEvent } from "@/lib/trace";

// Every number on this page was measured on a real run (see docs and the e2e tests); none is a placeholder.
const MINUTES_SAVED_PER_HOUR = 47; // a 5-minute lecture: reading the notes vs watching

/** Fades and rises into place the first time it scrolls into view; instant under reduced motion. */
export function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      el.dataset.in = "";
      io.disconnect();
    }, { rootMargin: "0px 0px -10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={box} data-reveal className={className} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/** Leans a few pixels toward the pointer and springs back: only for the main call to action. */
export function Magnetic({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  return (
    <span ref={box} className="magnetic inline-block"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const dx = ((e.clientX - r.left) / r.width - 0.5) * 12;
        const dy = ((e.clientY - r.top) / r.height - 0.5) * 12;
        e.currentTarget.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      }}
      onPointerLeave={(e) => (e.currentTarget.style.transform = "")}>
      {children}
    </span>
  );
}

export const STATS: [string, string][] = [
  ["~10 s", "for a 5-minute video"],
  ["100%", "of notes backed by the video, in the sample"],
  [`${MINUTES_SAVED_PER_HOUR} min`, "saved per hour of video"],
  ["4", "Meta models on every video"],
];

const FEATURES: { icon: IconName; title: string; text: string; image: string; w: number; h: number; wide?: boolean }[] = [
  { icon: "check", title: "Notes with proof", text: "Every point links to the second it was said or shown.", image: "notes", w: 1200, h: 1104, wide: true },
  { icon: "diagram", title: "The diagram it explains", text: "Drawn from what the video says and shows.", image: "diagram", w: 1200, h: 658 },
];

/** A feature tile: tilts a little toward the pointer, with a glow that follows it. */
function Tile({ f }: { f: (typeof FEATURES)[number] }) {
  return (
    <article
      className={`tile group relative flex flex-col overflow-hidden rounded-2xl glass ring-1 ring-rule ${f.wide ? "lg:col-span-2" : ""}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        e.currentTarget.style.setProperty("--mx", `${x * 100}%`);
        e.currentTarget.style.setProperty("--my", `${y * 100}%`);
        e.currentTarget.style.setProperty("--rx", `${(0.5 - y) * 6}deg`);
        e.currentTarget.style.setProperty("--ry", `${(x - 0.5) * 6}deg`);
      }}
      onPointerLeave={(e) => ["--rx", "--ry"].forEach((v) => e.currentTarget.style.removeProperty(v))}
    >
      <div className="relative z-10 p-5">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-scan-soft text-scan-ink"><Icon name={f.icon} /></span>
          {f.title}
        </h3>
        <p className="mt-1.5 text-sm text-graphite">{f.text}</p>
      </div>
      <div className="relative mx-5 mb-5 max-h-72 overflow-hidden rounded-xl ring-1 ring-rule">
        {/* eslint-disable-next-line @next/next/no-img-element -- static product captures, already WebP and sized */}
        <img src={`/landing/${f.image}.webp`} alt={`${f.title}: a real VidMind result`} width={f.w} height={f.h} loading="lazy"
          className="w-full object-cover object-top transition duration-500 group-hover:scale-[1.02]" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-sheet to-transparent" />
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

const MODELS: { icon: IconName; name: string; does: string }[] = [
  { icon: "spark", name: "Muse Spark", does: "Watches and hears each section, writes the notes, the diagram and the takeaways, and judges the web check" },
  { icon: "listen", name: "Muse Voice Transcribe", does: "Turns the speech into timed text, in 6-second pieces at once, so every quote can be checked" },
  { icon: "frame", name: "SAM 3.1", does: "Tracks the diagrams through the video, cropping them for the notes model" },
  { icon: "image", name: "Muse Image", does: "Draws a summary card, whose text is read back and must match the notes" },
];

const MEASURED: [string, string][] = [
  ["8.8 s", "A 10-minute talk, start to checked notes (3 runs: 8.8-9.1 s; was 16.9 s)"],
  ["19 / 19", "Notes on the sample that passed the evidence check against the transcript and keyframes"],
  ["0", "Notes shown without proof: anything the video can't back is thrown out, with the reason"],
];

const FAQ: [string, string][] = [
  ["What happens to my video?", "It's processed on this server and deleted after 24 hours. The video, its transcript and screen text go to Meta's Model API to write the notes."],
  ["How is a note “proven”?", "Every quote must match the transcript within seconds of when it was said, and every on-screen citation must match a real frame. Notes that fail are fixed once or thrown out, and the page shows what was thrown out and why."],
  ["What can it read?", "Uploads up to 12 hours and 2 GB (MP4, MOV, WebM, MKV), or YouTube, Vimeo and direct links. Paid and copy-protected courses aren't supported."],
];

/** Everything below the hero. */
export default function Landing() {
  const [hours, setHours] = useState(5);
  const saved = hours * MINUTES_SAVED_PER_HOUR;
  return (
    <>
      <section aria-labelledby="trick" className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
        <Reveal>
          <h2 id="trick" className="max-w-[24ch] font-display text-4xl font-semibold tracking-tight sm:text-5xl">A summary hears the words. VidMind also reads the screen.</h2>
          <p className="mt-3 max-w-[60ch] text-graphite">In our sample video the retention target, 40%, is only on a slide. Nobody says it.</p>
        </Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Reveal className="rounded-2xl glass p-6 ring-1 ring-rule">
            <p className="text-sm font-semibold text-graphite">A transcript-only summary</p>
            <p className="mt-3 font-display text-lg">“The team discussed week-1 retention and how it&apos;s measured.”</p>
            <p className="mt-3 text-sm text-strike">The number is missing: it was never spoken.</p>
          </Reveal>
          <Reveal delay={120} className="relative rounded-2xl glass p-6 ring-2 ring-proof">
            <p className="text-sm font-semibold text-proof">VidMind</p>
            <p className="mt-3 font-display text-lg">“The week-1 retention target is 40%.”</p>
            <p className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-proof-soft px-2.5 py-1 text-proof">seen on screen at 0:30</span>
              <span className="rounded-full bg-scan-soft px-2.5 py-1 text-scan-ink">never said aloud</span>
            </p>
            <span className="absolute -top-3 right-5 rotate-[-4deg] rounded-md border-2 border-proof bg-sheet px-2 font-display font-bold text-proof">Proven</span>
          </Reveal>
        </div>
      </section>

      <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-8">
        <Reveal>
          <h2 id="features-title" className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">One video in. Everything you need out.</h2>
          <p className="mt-3 text-graphite">Every image here is a real result, captured from the app.</p>
        </Reveal>
        <div className="mt-8 grid gap-4 [perspective:1400px] md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 60} className={f.wide ? "lg:col-span-2 [&>article]:h-full" : "[&>article]:h-full"}>
              <Tile f={f} />
            </Reveal>
          ))}
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-8">
        <Reveal>
          <h2 id="how-title" className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Watch it work, every model, every second.</h2>
          <p className="mt-3 max-w-[60ch] text-graphite">Speech, keyframes, diagrams and notes all run at once. Green bars won; hatched ones were backups.</p>
        </Reveal>
        <Reveal className="mt-8"><RunReplay /></Reveal>
      </section>

      <section aria-labelledby="models-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
        <Reveal><h2 id="models-title" className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Built on Meta&apos;s models</h2></Reveal>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODELS.map((m, i) => (
            <li key={m.name}>
              <Reveal delay={i * 60} className="h-full rounded-2xl glass p-5 ring-1 ring-rule">
                <span className="grid size-10 place-items-center rounded-xl bg-scan-soft text-scan-ink"><Icon name={m.icon} className="size-5" /></span>
                <p className="mt-3 font-display font-semibold">{m.name}</p>
                <p className="mt-1 text-sm text-graphite">{m.does}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="measured-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
        <Reveal>
          <h2 id="measured-title" className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Measured, not claimed</h2>
          <p className="mt-3 text-graphite">From our test runs. These are not user reviews.</p>
        </Reveal>
        <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MEASURED.map(([n, what], i) => (
            <Reveal key={what} delay={i * 60} className="rounded-2xl glass p-5 ring-1 ring-rule">
              <dt className="tabular font-display text-3xl font-bold text-scan-ink">{n}</dt>
              <dd className="mt-2 text-sm text-graphite">{what}</dd>
            </Reveal>
          ))}
        </dl>
        <Reveal className="mt-6 rounded-2xl glass p-6 ring-1 ring-rule">
          <label htmlFor="hours" className="font-display font-semibold">How many hours of video do you watch a week?</label>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <input id="hours" type="range" min={1} max={20} value={hours} onChange={(e) => setHours(Number(e.target.value))}
              className="min-h-11 flex-1 accent-[var(--scan)]" aria-describedby="saved" />
            <span className="tabular w-16 text-right font-semibold">{hours} h</span>
          </div>
          <p id="saved" className="mt-3 text-lg" aria-live="polite">
            About <b className="tabular text-proof">{Math.floor(saved / 60)} h {saved % 60} min</b> back every week, at {MINUTES_SAVED_PER_HOUR} min saved per hour of video.
          </p>
        </Reveal>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:px-8">
        <Reveal><h2 id="faq-title" className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Questions</h2></Reveal>
        <div className="mt-6 divide-y divide-rule rounded-2xl glass ring-1 ring-rule">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5">
              <summary className="hit flex cursor-pointer items-center justify-between gap-4 py-4 font-display font-semibold">
                {q}<span aria-hidden className="text-graphite transition group-open:rotate-45">+</span>
              </summary>
              <p className="pb-4 text-graphite">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
        <Reveal className="relative overflow-hidden rounded-3xl glass trace px-6 py-14 text-center ring-1 ring-rule">
          <span aria-hidden className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-scan/20 blur-3xl" />
          <h2 className="relative font-display text-4xl font-semibold tracking-tight sm:text-5xl">Your next video, proven in seconds.</h2>
          <div className="relative mt-6 flex flex-wrap items-center justify-center gap-4">
            <Magnetic>
              <Link href="/" className="inline-flex min-h-12 items-center rounded-full bg-scan px-7 font-display font-semibold text-on-scan shadow-[0_8px_30px_rgb(139_123_255/0.35)] transition hover:brightness-110">
                Make notes
              </Link>
            </Magnetic>
            <Link href="/jobs/sample" className="hit text-scan-ink underline underline-offset-4">See a finished example</Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
