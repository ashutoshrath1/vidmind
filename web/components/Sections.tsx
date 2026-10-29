import { Chip, EvidenceChip, type Seek, TimeButton } from "@/components/ui";
import { type Chapter, type Note, formatSeconds, formatTime, modelHost, modelName } from "@/lib/api";
import type { Attempt, Check, SectionView } from "@/lib/trace";

const range = (s: SectionView) => `${formatTime(s.lo)} to ${formatTime(s.hi)}`;

/** A section still being worked on: its transcript arriving, the models racing on it, and its citation check. */
export function SectionLive({ section: s, now, failed, base, seek }: { section: SectionView; now: number; failed: boolean; base: string; seek: Seek }) {
  const state = failed
    ? "Every model failed on this section"
    : !s.lines
      ? "Waiting for its transcript"
      : !s.attempts.length
        ? "Sending it to the notes model"
        : s.notes.length
          ? `Writing: ${s.notes.length} checked note${s.notes.length === 1 ? "" : "s"} so far`
          : s.checks.length
            ? "Checking every citation against the video"
            : "Models are writing";
  return (
    <article id={chapterId(s.lo)} aria-label={`Section ${s.i + 1}`} aria-busy={!failed} className="scroll-mt-32 space-y-4 rounded-lg bg-sheet p-5 ring-1 ring-rule">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">
          Section {s.i + 1} <span className="tabular font-normal text-graphite">{range(s)}</span>
        </h2>
        <p className={`text-sm ${failed ? "text-strike" : s.attempts.length ? "text-scan-ink" : "text-wait"}`}>{state}</p>
      </header>
      {s.notes.length > 0 && <NoteList notes={s.notes} start={s.lo} base={base} seek={seek} />}
      <Transcript section={s} />
      {s.attempts.length > 0 && <ModelRace attempts={s.attempts} now={now} />}
      {s.checks.length > 0 && <Checks checks={s.checks} />}
    </article>
  );
}

function Transcript({ section: s }: { section: SectionView }) {
  if (!s.lines) return <p className="scanning h-16 rounded-lg bg-lightbox" aria-label="Transcript on its way" />;
  if (!s.lines.length) return <p className="text-sm text-graphite">No speech in this section.</p>;
  const shown = s.lines.slice(0, 4);
  return (
    <div className="arrive">
      <p className="mb-1.5 flex flex-wrap gap-2 text-xs text-graphite">
        <Chip>{s.engine === "creator subtitles" ? "Creator subtitles" : `Heard by ${modelName(s.engine ?? "")}`}</Chip>
        <Chip>{s.lines.length} lines</Chip>
        {!!s.transcribeSeconds && <Chip>{formatSeconds(s.transcribeSeconds)}</Chip>}
      </p>
      <ul className="space-y-1 border-l-2 border-rule pl-3 text-sm leading-relaxed">
        {shown.map((l, i) => (
          <li key={i} className="arrive" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="tabular mr-2 font-mono text-graphite">{formatTime(l.start)}</span>
            {l.text}
          </li>
        ))}
        {s.lines.length > shown.length && <li className="text-graphite">and {s.lines.length - shown.length} more lines</li>}
      </ul>
    </div>
  );
}

const reasons: Record<string, string> = { first: "first try", hedge: "joined: first was slow", fallback: "took over after a failure" };

/** Models racing on one section: a lane each, filling while it works. The first answer that passes the check wins. */
export function ModelRace({ attempts, now }: { attempts: Attempt[]; now: number }) {
  const elapsed = (a: Attempt) => a.seconds ?? Math.max(0, now - a.start);
  const scale = Math.max(8, ...attempts.map(elapsed));
  return (
    <ul aria-label="Model race" className="space-y-2">
      {attempts.map((a, i) => {
        const t = elapsed(a);
        const tone = a.state === "won" ? "bg-proof" : a.state === "failed" ? "bg-strike" : a.state === "ended" ? "bg-graphite/50" : "bg-scan";
        return (
          <li key={i} className={`space-y-1 ${a.state === "won" ? "pop" : ""} ${a.reason === "hedge" ? "arrive" : ""}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-semibold">{modelName(a.model)}</span>
              {modelHost(a.model) && <Chip>{modelHost(a.model)}</Chip>}
              <span className={`text-xs ${a.reason === "first" ? "text-graphite" : "text-scan-ink"}`}>{reasons[a.reason] ?? a.reason}</span>
              <span className="tabular ml-auto font-display text-sm">
                {a.state === "won" ? (
                  <span className="text-proof">won in {formatSeconds(t)}</span>
                ) : a.state === "failed" ? (
                  <span className="text-strike" title={a.error}>
                    failed after {formatSeconds(t)}
                  </span>
                ) : a.state === "ended" ? (
                  <span className="text-graphite">finished second, {formatSeconds(t)}</span>
                ) : (
                  formatSeconds(t)
                )}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-lightbox">
              <div className={`lane-fill h-full rounded-full ${tone} ${a.state === "running" ? "scanning" : ""}`} style={{ width: `${Math.max(3, (t / scale) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul aria-label="Citation check" className="space-y-1.5 text-sm">
      {checks.map((c, i) => (
        <li key={i} className="arrive">
          {/* The trust moment: a wrong citation is caught (stamp + shake), then fixed on the re-check. */}
          <span
            className={`stamp mr-2 rounded border-2 px-1.5 font-display text-xs font-bold ${c.problems.length ? "shake border-strike text-strike" : "border-proof text-proof"}`}
          >
            {c.problems.length ? "Caught" : c.round === 1 ? "Verified" : "Fixed"}
          </span>
          <span className="text-graphite">{modelName(c.model)}:</span>{" "}
          {c.problems.length ? (
            <span className="text-strike">
              {c.problems.length} citation{c.problems.length === 1 ? "" : "s"} didn&apos;t match the video
              {c.round === 1 ? ", sent back to fix" : ", those notes are removed"}
            </span>
          ) : (
            <span className="text-proof">all {c.notes} notes matched the video</span>
          )}
          {c.problems.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-graphite">What didn&apos;t match</summary>
              <ul className="mt-1 space-y-1 text-xs text-graphite">
                {c.problems.map((p, j) => (
                  <li key={j}>{p.replace(/^chapter \d+ /, "")}</li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export const chapterId = (start: number) => `chapter-${Math.round(start)}`;

type ChapterProps = { chapter: Chapter; base: string; seek: Seek; section?: SectionView; fresh?: boolean };

/** A finished chapter, read like an article section: heading, summary, then its notes, each with quiet proof. */
export function ChapterView({ chapter: ch, base, seek, section, fresh }: ChapterProps) {
  const winner = section?.attempts.find((a) => a.state === "won");
  const fixed = section?.checks.find((c) => c.round === 1)?.problems.length ?? 0;
  return (
    <article id={chapterId(ch.start_seconds)} className={`arrive scroll-mt-32 space-y-5 ${fresh ? "flash rounded-lg" : ""}`}>
      <header className="space-y-2">
        <h2 className="font-display text-[1.75rem] leading-tight font-bold text-balance">{ch.title}</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-graphite">
          <TimeButton t={ch.start_seconds} seek={seek} />
          {winner && (
            <span aria-label="How this section was made">
              Written by {modelName(winner.model)} in {formatSeconds(winner.seconds ?? 0)}
              {section!.attempts.length > 1 && `, ${section!.attempts.length} models raced`}
              {fixed > 0 && `, ${fixed} citation${fixed === 1 ? "" : "s"} fixed on re-check`}
              {(section?.done?.rejected ?? 0) > 0 && `, ${section!.done!.rejected} removed`}
            </span>
          )}
        </p>
      </header>
      {ch.summary && <p className="text-lg leading-[1.75] text-graphite">{ch.summary}</p>}
      {ch.cover_url && (
        <button
          onClick={() => seek(ch.start_seconds)}
          aria-label={`Play "${ch.title}" from ${formatTime(ch.start_seconds)}`}
          className="block w-full max-w-sm overflow-hidden rounded-lg bg-ink ring-1 ring-rule transition hover:ring-2 hover:ring-scan"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API host */}
          <img src={`${base}/${ch.cover_url}`} alt="" className="aspect-video w-full object-cover" />
        </button>
      )}
      <NoteList notes={ch.notes} start={ch.start_seconds} base={base} seek={seek} />
      {ch.key_terms.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Key terms">
          {ch.key_terms.map((k) => (
            <li key={k} className="rounded-full bg-sheet px-2.5 py-0.5 text-xs text-graphite ring-1 ring-rule">
              {k}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Notes as a bulleted list: the text to read first, then its second and proof, small and quiet. */
function NoteList({ notes, start, base, seek }: { notes: Note[]; start: number; base: string; seek: Seek }) {
  return (
    <ul className="space-y-5">
      {notes.map((n, i) => (
        <li key={i} className="relative pl-6 before:absolute before:top-[0.7em] before:left-1 before:size-1.5 before:rounded-full before:bg-scan">
          <p className="text-lg leading-[1.7]">{n.text}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-graphite">
            {/* Each proof pill carries its own time; a bare time only when there is no proof. */}
            {!n.evidence.length && <span className="tabular mr-1 font-mono">{formatTime(start)}</span>}
            {n.uncertain && (
              <Chip tone="strike" title={n.uncertain_reason ?? undefined}>
                Uncertain{n.uncertain_reason ? `: ${n.uncertain_reason}` : ""}
              </Chip>
            )}
            {n.evidence.map((e, j) => (
              <EvidenceChip key={j} evidence={e} base={base} seek={seek} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
