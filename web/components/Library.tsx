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
          Notes made in this browser, with no account. The server deletes each video after 24 hours.
        </p>
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
            return (
              <li key={r.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 ${expired ? "text-graphite" : ""}`}>
                <div className="min-w-0 flex-1">
                  {expired ? (
                    <p className="truncate font-medium">{r.title}</p>
                  ) : (
                    <Link href={`/jobs/${r.id}`} className="hit block truncate font-medium hover:text-scan-ink">{r.title}</Link>
                  )}
                  <p className="text-sm text-graphite">{when.format(r.at)}</p>
                </div>
                <p className="flex flex-wrap gap-1.5">
                  {expired ? <Chip tone="strike">Expired</Chip> : null}
                </p>
              </li>
            );
          })}
          {!shown.length && <li className="px-4 py-3 text-graphite">No titles match &ldquo;{query.trim()}&rdquo;.</li>}
        </ul>
      </div>
    </section>
  );
}
