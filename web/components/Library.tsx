"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Icon from "@/components/Icon";
import { Button, Chip, inputClass } from "@/components/ui";
import { API_URL, formatTime, jobUrl } from "@/lib/api";
import { parseRecent, readRecent, subscribeRecent } from "@/lib/recent";

const MAX_ASK = 10; // the API answers across at most ten videos
const MODES: Record<string, [icon: "lecture" | "meeting" | "demo", label: string]> = {
  learn: ["lecture", "Lecture"],
  meet: ["meeting", "Meeting"],
  test: ["demo", "Demo"],
};
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
// Checked once per id per visit to the app, one request at a time, so a long list never floods the API.
const checked = new Map<string, boolean>(); // id → gone from the server

type Citation = { job_id: string; title: string; start_seconds: number; quote: string };
type Asked = { question: string; answer?: string; citations?: Citation[]; error?: string };

export default function Library() {
  const raw = useSyncExternalStore(subscribeRecent, readRecent, () => "[]");
  const list = useMemo(() => parseRecent(raw), [raw]);
  const [gone, setGone] = useState<Record<string, boolean>>(() => Object.fromEntries(checked));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null); // null: every live video, up to ten
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<Asked | null>(null);
  // The app keeps visited pages alive in the background: coming back starts clean.
  useEffect(() => () => {
    setQuery("");
    setPicked(null);
    setQuestion("");
    setBusy(false);
    setAsked(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const r of list) {
        if (cancelled) return;
        if (!checked.has(r.id)) {
          try {
            const res = await fetch(jobUrl(r.id));
            checked.set(r.id, res.status === 404);
          } catch {
            return; // API unreachable: unknown, not expired
          }
        }
        const isGone = checked.get(r.id)!;
        if (!cancelled) setGone((g) => (g[r.id] === isGone ? g : { ...g, [r.id]: isGone }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [list]);

  const live = list.filter((r) => !gone[r.id]);
  const chosen = (picked ?? live.map((r) => r.id)).filter((id) => live.some((r) => r.id === id)).slice(0, MAX_ASK);
  const shown = list.filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  async function ask() {
    const q = question.trim();
    if (q.length < 2 || busy || !chosen.length) return;
    setBusy(true);
    let item: Asked;
    try {
      const res = await fetch(`${API_URL}/ask-across`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: chosen, question: q }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await res.json();
      item = res.ok
        ? { question: q, ...body }
        : { question: q, error: res.status === 404 ? "A chosen video is no longer on the server. Reload the page and try again." : typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).` };
    } catch {
      item = { question: q, error: "Could not reach the VidMind API. Check that it is running on port 8000." };
    }
    setAsked(item);
    setBusy(false);
  }

  if (!list.length)
    return (
      <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Library</h1>
        <p className="mt-3 max-w-[60ch] text-graphite">
          Notes you make in this browser show up here.{" "}
          <Link href="/" className="hit text-scan-ink underline underline-offset-4">Make notes from a video</Link> or{" "}
          <Link href="/jobs/sample" className="hit text-scan-ink underline underline-offset-4">open the sample</Link>.
        </p>
      </section>
    );

  return (
    <section className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-10 sm:px-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Library</h1>
        <p className="mt-3 max-w-[60ch] text-graphite">
          Notes made in this browser, with no account. The server deletes each video after 24 hours unless you keep it.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="space-y-3"
      >
        <label htmlFor="ask-across" className="block font-display text-xl font-semibold">
          Ask across {chosen.length === 1 ? "1 video" : `${chosen.length} videos`}
        </label>
        <div className={`flex items-center gap-2 rounded-full bg-sheet p-1.5 pl-5 ring-2 transition focus-within:ring-scan ${busy ? "scanning ring-scan" : "ring-rule"}`}>
          <Icon name="chat" className="size-4 text-graphite" />
          <input
            id="ask-across"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            disabled={busy || !chosen.length}
            placeholder={chosen.length ? "Ask what these videos say or show" : "Choose a video below first"}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-graphite"
          />
          <Button type="submit" disabled={busy || !chosen.length || question.trim().length < 2} working={busy} className="px-4">
            Ask
          </Button>
        </div>
        <p className="text-xs text-graphite">One answer from the chosen videos, each point linked to the second it came from.</p>
      </form>

      <div aria-live="polite">
        {busy && <p className="text-sm text-graphite">Reading {chosen.length === 1 ? "1 video" : `${chosen.length} videos`}, then checking each citation…</p>}
        {asked && !busy && (
          <div className="arrive space-y-3 rounded-lg bg-sheet p-5 ring-1 ring-rule">
            <p className="font-semibold">{asked.question}</p>
            {asked.error && <p className="text-sm text-strike">{asked.error}</p>}
            {asked.answer && <p className={`max-w-[70ch] leading-relaxed ${asked.citations?.length ? "" : "text-graphite"}`}>{asked.answer}</p>}
            {!!asked.citations?.length && (
              <ul className="flex flex-wrap gap-2">
                {asked.citations.map((c) => (
                  <li key={`${c.job_id}-${c.start_seconds}`} className="max-w-full">
                    <Link
                      href={`/jobs/${c.job_id}?t=${Math.floor(c.start_seconds)}`}
                      aria-label={`${c.title} at ${formatTime(c.start_seconds)}: ${c.quote}. Open the video there`}
                      className="group relative inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-lightbox px-3 text-xs ring-1 ring-rule transition hover:ring-scan focus-visible:ring-scan"
                    >
                      <span className="truncate">{c.title}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular shrink-0 font-mono text-graphite group-hover:text-scan-ink">{formatTime(c.start_seconds)}</span>
                      <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-30 mb-1.5 hidden w-max max-w-72 rounded-md bg-ink px-2.5 py-1.5 text-left text-xs leading-snug text-lightbox shadow-lg group-hover:block group-focus-visible:block">
                        {c.quote}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {asked.answer && (asked.citations?.length ? <Chip tone="proof">Every citation is a real second of a chosen video</Chip> : <Chip>Not in these videos</Chip>)}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Your notes</h2>
          <div className="relative w-full sm:w-64">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-graphite" />
            <input type="search" aria-label="Search by title" placeholder="Search by title" value={query}
              onChange={(e) => setQuery(e.target.value)} className={`${inputClass} min-h-11 py-2 pl-9`} />
          </div>
        </div>
        <ul className="divide-y divide-rule overflow-hidden rounded-lg bg-sheet ring-1 ring-rule">
          {shown.map((r) => {
            const expired = !!gone[r.id];
            const on = chosen.includes(r.id);
            const mode = r.mode ? MODES[r.mode] : undefined;
            return (
              <li key={r.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 ${expired ? "text-graphite" : ""}`}>
                <input type="checkbox" checked={on} disabled={expired || (!on && chosen.length >= MAX_ASK)} onChange={() => toggle(r.id)}
                  aria-label={`Include ${r.title} in the question`} className="size-4 accent-scan" />
                <div className="min-w-0 flex-1">
                  {expired ? (
                    <p className="truncate font-medium">{r.title}</p>
                  ) : (
                    <Link href={`/jobs/${r.id}`} className="hit block truncate font-medium hover:text-scan-ink">{r.title}</Link>
                  )}
                  <p className="text-sm text-graphite">{when.format(r.at)}</p>
                </div>
                <p className="flex flex-wrap gap-1.5">
                  {mode && <Chip><Icon name={mode[0]} className="size-3.5" />{mode[1]}</Chip>}
                  {expired ? <Chip tone="strike">Expired</Chip> : null}
                </p>
              </li>
            );
          })}
          {!shown.length && <li className="px-4 py-3 text-graphite">No titles match &ldquo;{query.trim()}&rdquo;.</li>}
        </ul>
        {live.length > MAX_ASK && <p className="text-sm text-graphite">Questions cover up to {MAX_ASK} videos at a time.</p>}
      </div>
    </section>
  );
}
