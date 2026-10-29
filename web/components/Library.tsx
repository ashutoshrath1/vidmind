"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Icon from "@/components/Icon";
import { Chip, inputClass } from "@/components/ui";
import { jobUrl } from "@/lib/api";
import { parseRecent, readRecent, subscribeRecent } from "@/lib/recent";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
// Checked once per id per visit to the app, one request at a time, so a long list never floods the API.
const checked = new Map<string, boolean>(); // id → gone from the server


export default function Library() {
  const raw = useSyncExternalStore(subscribeRecent, readRecent, () => "[]");
  const list = useMemo(() => parseRecent(raw), [raw]);
  const [gone, setGone] = useState<Record<string, boolean>>(() => Object.fromEntries(checked));
  const [query, setQuery] = useState("");
  // The app keeps visited pages alive in the background: coming back starts clean.
  useEffect(() => () => {
    setQuery("");
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

  const shown = list.filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase()));

  const header = (
    <header>
      <h1 className="font-display text-5xl font-bold tracking-[-0.03em] sm:text-6xl">Library</h1>
      <p className="mt-4 max-w-[52ch] text-xl text-graphite">
        {list.length ? "Notes made in this browser, with no account. The server deletes each video after 24 hours." : "Your notes will appear here. Paste a link on the home page to make your first."}
      </p>
    </header>
  );

  if (!list.length)
    return (
      <section className="mx-auto w-full max-w-3xl flex-1 px-4 pt-16 pb-24 sm:px-6 sm:pt-24">
        {header}
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-full bg-scan px-6 font-medium text-on-scan transition hover:brightness-110">Make notes</Link>
          <Link href="/jobs/sample" className="hit inline-flex items-center gap-1 text-scan-ink hover:underline">Open the example <Icon name="arrow" /></Link>
        </div>
      </section>
    );

  return (
    <section className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 pt-16 pb-24 sm:px-6 sm:pt-24">
      {header}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">Your notes</h2>
          <div className="relative w-full sm:w-64">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-graphite" />
            <input type="search" aria-label="Search by title" placeholder="Search by title" value={query}
              onChange={(e) => setQuery(e.target.value)} className={`${inputClass} min-h-11 rounded-full py-2 pl-10`} />
          </div>
        </div>
        <ul className="divide-y divide-rule overflow-hidden rounded-3xl bg-sheet ring-1 ring-rule">
          {shown.map((r) => {
            const expired = !!gone[r.id];
            return (
              <li key={r.id} className={`flex items-center gap-4 px-5 py-4 ${expired ? "text-graphite" : ""}`}>
                <div className="min-w-0 flex-1">
                  {expired ? (
                    <p className="truncate font-medium">{r.title}</p>
                  ) : (
                    <Link href={`/jobs/${r.id}`} className="hit block truncate font-display text-lg font-semibold transition-colors hover:text-scan-ink">{r.title}</Link>
                  )}
                  <p className="text-sm text-graphite">{when.format(r.at)}</p>
                </div>
                {expired ? <Chip tone="strike">Expired</Chip> : <Icon name="arrow" className="size-4 text-graphite" />}
              </li>
            );
          })}
          {!shown.length && <li className="px-5 py-4 text-graphite">No titles match &ldquo;{query.trim()}&rdquo;.</li>}
        </ul>
      </div>
    </section>
  );
}
