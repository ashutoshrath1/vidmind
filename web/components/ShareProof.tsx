"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { Button, inputClass } from "@/components/ui";
import { type JobStatus, jobUrl } from "@/lib/api";
import { keepRecent } from "@/lib/recent";
import { expiresAt, proofLink } from "@/lib/share";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** On the result page: copy the proof link, and keep the job past the default 24 hours. */
export default function ShareProof({ jobId, job }: { jobId: string; job: JobStatus | null }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keepUntil, setKeepUntil] = useState(job?.keep_until ?? null);
  const [kept, setKept] = useState(keepUntil != null); // flips on click, so the box answers before the server does
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sample = jobId === "sample";

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function share() {
    const url = proofLink(location.origin, jobId);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setLink(url); // no clipboard (blocked, or not a secure origin): show the link to copy by hand
    }
  }

  async function keep(on: boolean) {
    setKept(on);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${jobUrl(jobId)}/keep`, {
        method: on ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: on ? JSON.stringify({ days: 30 }) : undefined,
      });
      if (!r.ok) throw new Error();
      const until: number | null = (await r.json()).keep_until;
      setKeepUntil(until);
      keepRecent(jobId, until ? until * 1000 : null); // the library keeps listing it as long as the server keeps it
    } catch {
      setKept(!on);
      setError("Couldn't change how long it's kept. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={share}>
          <Icon name="share" />
          Share proof link
        </Button>
        <span aria-live="polite" className="text-proof">{copied ? "Link copied" : ""}</span>
      </div>
      {link && (
        <input readOnly value={link} aria-label="Proof link" autoFocus onFocus={(e) => e.currentTarget.select()} className={`${inputClass} font-mono text-sm`} />
      )}
      <p className="text-graphite">Anyone with the link can see these notes and the video frames.</p>
      {sample ? (
        <p className="text-graphite">The sample is kept permanently.</p>
      ) : (
        <>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={kept} disabled={busy} onChange={(e) => keep(e.currentTarget.checked)} className="size-4 accent-scan" />
            Keep for 30 days
          </label>
          {job?.created_at && (
            <p className="text-graphite">Deleted from the server on {when.format(expiresAt(job.created_at, keepUntil))}.</p>
          )}
          {error && <p role="alert" className="text-strike">{error}</p>}
        </>
      )}
    </div>
  );
}
