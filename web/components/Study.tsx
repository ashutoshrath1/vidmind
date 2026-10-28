"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { save } from "@/components/ModeOutput";
import { Button, Chip, TimeButton, type Seek } from "@/components/ui";
import { type Deck, formatTime } from "@/lib/api";
import { type Progress, cardKey, dueIn, loadProgress, review, saveProgress, schedule } from "@/lib/deck";
import { toAnkiCsv } from "@/lib/export";

/** Flashcards written from the checked notes. "Again" plays the moment that holds the answer. */
export default function Study({ jobId, base, seek, youtubeId, title }: { jobId: string; base: string; seek: Seek; youtubeId: string | null; title: string }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [flipped, setFlipped] = useState(false);
  const [now, setNow] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const cardRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${base}/deck`, { method: "POST", signal: abort.signal });
        const body = await res.json().catch(() => ({})); // a proxy error page isn't JSON
        if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).`);
        setProgress(loadProgress(jobId));
        setNow(Date.now());
        setDeck(body);
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof TypeError ? "Could not reach the VidMind API. Check that it is running on port 8000." : String((e as Error).message));
      }
    })();
    return () => abort.abort(); // the tab closed: drop the request, the server still saves the deck
  }, [base, jobId, attempt]);

  const { due, learned, next } = schedule(deck?.cards ?? [], progress, now);
  const card = due[0];
  const done = !!deck && !card;

  // The last due card was graded: its button is gone, so keep focus on the page instead of dropping it to <body>.
  useEffect(() => {
    if (done && document.activeElement === document.body) doneRef.current?.focus();
  }, [done]);

  // Nothing due: look again when the next card is due, so it comes back without a reload.
  useEffect(() => {
    if (card || next == null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(next - now + 50, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [card, next, now]);

  function grade(gotIt: boolean) {
    if (!card) return;
    const t = Date.now();
    if (!gotIt) seek(card.start_seconds); // hear the moment that holds the answer
    const updated = { ...progress, [cardKey(card)]: review(progress[cardKey(card)], gotIt, t) };
    saveProgress(jobId, updated);
    setProgress(updated);
    setNow(t);
    setFlipped(false);
    cardRef.current?.focus();
  }

  const onGradeKey = useEffectEvent(grade);
  useEffect(() => {
    if (!flipped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (e.key === "1" || e.key === "2") onGradeKey(e.key === "2");
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [flipped]);

  if (error)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-strike-soft px-4 py-3 text-sm text-strike">
        <p className="min-w-0 flex-1">{error}</p>
        <Button variant="quiet" onClick={() => { setError(null); setAttempt((a) => a + 1); }}>Try again</Button>
      </div>
    );
  if (!deck)
    return (
      <p className="scanning rounded-lg bg-sheet p-5 text-graphite ring-1 ring-rule" aria-live="polite">
        Writing flashcards from the checked notes, then checking each one against its note
      </p>
    );
  if (!deck.cards.length) return <p className="rounded-lg bg-sheet p-5 text-graphite ring-1 ring-rule">No card passed the check, so there is nothing to study.</p>;

  const slug = title.replace(/[^\w-]+/g, " ").trim() || "video";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <Chip tone="scan">{due.length} due now</Chip>
        <Chip tone="proof">{learned} learned</Chip>
        <Chip>{deck.cards.length} cards</Chip>
        {deck.dropped > 0 && <Chip title="Cards whose note or second didn't match the checked notes">{deck.dropped} failed the check</Chip>}
      </div>

      {card ? (
        <div className="space-y-3">
          <button
            ref={cardRef}
            autoFocus
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? `Answer: ${card.back}. Show the question` : `Question: ${card.front}. Show the answer`}
            className="glass flex min-h-48 w-full flex-col justify-center gap-3 rounded-2xl p-6 text-left ring-1 ring-rule transition hover:ring-scan sm:p-8"
          >
            <span className="text-sm text-graphite">{flipped ? "Answer" : card.kind === "cloze" ? "Fill the blank" : "Question"}</span>
            <span key={String(flipped)} className="arrive font-display text-xl font-semibold leading-snug">{flipped ? card.back : card.front}</span>
            {!flipped && <span className="text-sm text-graphite">Press Space or click to see the answer</span>}
          </button>
          {flipped && (
            <>
              <p className="flex flex-wrap items-baseline gap-2 text-sm text-graphite">
                <TimeButton t={card.start_seconds} seek={seek} />
                <span className="min-w-0 flex-1">From the note: {card.source_note}</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="quiet" onClick={() => grade(false)} aria-keyshortcuts="1">
                  Again <kbd className="font-mono text-xs text-graphite">1</kbd>
                </Button>
                <Button onClick={() => grade(true)} aria-keyshortcuts="2">
                  Got it <kbd className="font-mono text-xs opacity-70">2</kbd>
                </Button>
              </div>
              <p className="text-xs text-graphite">Again plays the video from {formatTime(card.start_seconds)}, where the answer is.</p>
            </>
          )}
        </div>
      ) : (
        <div ref={doneRef} tabIndex={-1} role="status" className="flex items-center gap-3 rounded-2xl bg-proof-soft p-6 text-proof">
          <Icon name="check" className="size-6" />
          <p>
            <span className="font-display font-semibold">Nothing due now.</span>{" "}
            {next != null && <>The next card is due {dueIn(next - now)}.</>}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        <Button variant="quiet" onClick={() => save(`${slug} flashcards.csv`, toAnkiCsv(deck.cards, youtubeId), "text/csv")}>
          Export to Anki (CSV)
        </Button>
        <p className="min-w-0 flex-1 text-xs text-graphite">
          {jobId === "sample" ? "Progress is saved in this browser." : "Progress is saved in this browser. The video and its notes are deleted after 24 hours, so export to keep studying."}
        </p>
      </div>
    </div>
  );
}
