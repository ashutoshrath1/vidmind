import type { ReactNode } from "react";
import { NoteLine, boldTerms } from "@/components/Cite";
import { Chip, type Seek } from "@/components/ui";
import { type Chapter, type Note, formatSeconds, formatTime, modelHost, modelName } from "@/lib/api";
import type { Attempt, Check, SectionView } from "@/lib/trace";

const range = (s: SectionView) => `${formatTime(s.lo)} to ${formatTime(s.hi)}`;

/** A section still being worked on: its transcript arriving, the models racing on it, and its citation check. */
export function SectionLive({ section: s, now, failed, seek }: { section: SectionView; now: number; failed: boolean; base: string; seek: Seek }) {
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
    <article id={chapterId(s.lo)} aria-label={`Section ${s.i + 1}`} aria-busy={!failed} className="scroll-mt-40 space-y-4 rounded-2xl bg-sheet p-5 font-sans text-base sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">
          Section {s.i + 1} <span className="tabular font-normal text-graphite">{range(s)}</span>
        </h2>
        <p className={`text-sm ${failed ? "text-strike" : s.attempts.length ? "text-scan-ink" : "text-wait"}`}>{state}</p>
      </header>
      {s.notes.length > 0 && <div className="notes-body"><NoteList notes={s.notes} seek={seek} /></div>}
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

type ChapterProps = { chapter: Chapter; seek: Seek; base: string; pending?: boolean; fresh?: boolean };

/** A finished chapter, read like a blog section: heading, lead line, illustration, then prose with its checked
 * citations. Results without the article yet (older ones, or still being written) show the notes instead. */
export function ChapterView({ chapter: ch, seek, base, pending, fresh }: ChapterProps) {
  const id = chapterId(ch.start_seconds);
  const article = ch.article?.filter((p) => p.text) ?? [];
  const lead = ch.hook || ch.summary;
  const { nodes, rest } = boldTerms([lead, ...(article.length ? article.map((p) => p.text) : ch.notes.map((n) => n.text))], ch.key_terms);
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`arrive scroll-mt-40 ${fresh ? "flash rounded-lg" : ""}`}>
      <h2 id={`${id}-h`} className="font-display text-[1.5rem] leading-[1.2] font-bold tracking-[-0.02em] text-balance sm:text-[1.75rem]">{ch.title}</h2>
      {lead && <p className={`mt-4 ${ch.hook ? "font-semibold" : ""}`}>{nodes[0]}</p>}
      {ch.image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the API per job, not a static asset
        <img src={`${base}/${ch.image_url}`} alt={ch.image_alt ?? ""} width={1280} height={720} loading="lazy" decoding="async"
          className="mt-7 aspect-video w-full rounded-2xl bg-sheet object-cover" />
      )}
      {article.length ? (
        article.map((p, i) => (
          <p key={i} className="mt-5">
            {nodes[i + 1]}
            {p.cites.map((c) => ch.notes[c] && <NoteLine key={c} note={ch.notes[c]} text="" seek={seek} />)}
          </p>
        ))
      ) : (
        <>
          {pending && <p className="scanning mt-5 w-fit rounded-full px-1 font-sans text-sm text-graphite">Writing the article…</p>}
          <NoteList notes={ch.notes} texts={nodes.slice(1)} seek={seek} />
        </>
      )}
      {rest.length > 0 && (
        <p className="mt-6 font-sans text-[0.9375rem] text-graphite">
          <span className="font-semibold text-ink">Key terms:</span> {rest.join(", ")}
        </p>
      )}
    </section>
  );
}

/** Notes as a plain bulleted list, each followed by its quiet citations. */
function NoteList({ notes, texts, seek }: { notes: Note[]; texts?: ReactNode[][]; seek: Seek }) {
  return (
    <ul className="mt-5 list-disc space-y-3 pl-6 marker:text-graphite/60">
      {notes.map((n, i) => (
        <li key={i} className="pl-1">
          <NoteLine note={n} text={texts?.[i]} seek={seek} />
        </li>
      ))}
    </ul>
  );
}
