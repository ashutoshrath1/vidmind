"use client";

import { useEffect, useState } from "react";
import { Button, Chip, EvidenceChip, type Seek } from "@/components/ui";
import { type Answer, formatSeconds, modelHost, modelName } from "@/lib/api";
import type { View } from "@/lib/trace";

type Asked = { question: string; answer?: Answer; error?: string };

export default function AskPanel({ base, seek, ready, view, questions, keyTerms }: { base: string; seek: Seek; ready: boolean; view: View; questions: string[]; keyTerms: string[] }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<{ question: string; started: number } | null>(null);
  const [now, setNow] = useState(0);
  const [asked, setAsked] = useState<Asked[]>([]);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [busy]);

  const lines = view.sections.reduce((n, s) => n + (s.lines?.length ?? 0), 0);
  const frames = view.frames.length;
  // The model's own curiosity questions; results from before they existed fall back to the key terms.
  const suggestions = questions.length ? questions.slice(0, 3) : [...new Set(keyTerms)].slice(0, 3).map((k) => `Why does ${k} matter here?`);

  async function ask(q: string, started: number) {
    q = q.trim();
    if (q.length < 2 || busy) return;
    setBusy({ question: q, started });
    setNow(started);
    let item: Asked;
    try {
      const res = await fetch(`${base}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await res.json();
      item = res.ok
        ? { question: q, answer: body }
        : { question: q, error: typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).` };
    } catch {
      item = { question: q, error: "Could not reach the VidMind API. Check that it is running on port 8000." };
    }
    setAsked((xs) => [item, ...xs]);
    setQuestion("");
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question, performance.now());
        }}
        className="space-y-3"
      >
        <label htmlFor="ask" className="block font-display text-xl font-semibold">
          Ask the video
        </label>
        <div className={`flex items-center gap-2 rounded-full bg-sheet p-1.5 pl-5 ring-2 transition focus-within:ring-scan focus-within:shadow-[0_0_0_6px_rgb(139_123_255/0.12)] ${busy ? "scanning ring-scan" : "ring-rule"}`}>
          <span aria-hidden className="text-graphite">⌕</span>
          <input
            id="ask"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            disabled={!ready || !!busy}
            placeholder={ready ? "Ask anything it says or shows" : "Opens when the notes are done"}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-graphite"
          />
          <Button type="submit" disabled={!ready || !!busy || question.trim().length < 2} working={!!busy} className="px-4">
            Ask ↵
          </Button>
        </div>
        {ready && !busy && suggestions.length > 0 && (
          <ul className="divide-y divide-rule overflow-hidden rounded-lg ring-1 ring-rule">
            {suggestions.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => void ask(s, performance.now())}
                  className="group flex min-h-11 w-full items-center gap-3 bg-sheet px-4 text-left transition hover:bg-lightbox">
                  <span aria-hidden className="text-scan-ink transition group-hover:scale-125">✦</span>
                  <span className="min-w-0 flex-1 truncate">{s}</span>
                  <span aria-hidden className="text-graphite transition group-hover:translate-x-1 group-hover:text-scan-ink">→</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-graphite">Answers come only from the video, checked, with the moment to jump to.</p>
      </form>

      {busy && (
        <div className="scanning rounded-lg bg-sheet p-5 ring-1 ring-rule" aria-live="polite">
          <p className="font-semibold">{busy.question}</p>
          <p className="tabular mt-2 text-sm text-graphite">
            Reading {lines ? `${lines} transcript lines` : "the transcript"}
            {frames ? ` and ${frames} keyframes` : ""}, then checking the answer&apos;s citations,{" "}
            {formatSeconds((now - busy.started) / 1000)}
          </p>
        </div>
      )}

      <ul className="space-y-4" aria-live="polite">
        {asked.map((a, i) => (
          <li key={asked.length - i} className="arrive space-y-3 rounded-lg bg-sheet p-5 ring-1 ring-rule">
            <p className="font-semibold">{a.question}</p>
            {a.error && <p className="text-sm text-strike">{a.error}</p>}
            {a.answer && (
              <>
                <p className={`max-w-[70ch] leading-relaxed ${a.answer.found ? "" : "text-graphite"}`}>{a.answer.answer}</p>
                <div className="flex flex-wrap gap-2">
                  {a.answer.evidence.map((e, ei) => (
                    <EvidenceChip key={ei} evidence={e} base={base} seek={seek} />
                  ))}
                </div>
                {a.answer.web && !!a.answer.sources?.length && (
                  <ul className="flex flex-wrap gap-2 text-sm">
                    {a.answer.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="hit text-scan-ink underline underline-offset-4">
                          {s.title} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="flex flex-wrap gap-1.5">
                  {a.answer.found ? <Chip tone="proof">Checked against the video</Chip> : a.answer.web ? <Chip tone="scan">Not in this video. From the web</Chip> : <Chip>Not in this video</Chip>}
                  {a.answer.model && (
                    <Chip>
                      {modelName(a.answer.model)}
                      {modelHost(a.answer.model) && ` on ${modelHost(a.answer.model)}`}
                    </Chip>
                  )}
                  {a.answer.seconds != null && <Chip>{formatSeconds(a.answer.seconds)}</Chip>}
                  {!!a.answer.rechecked && <Chip tone="scan">{a.answer.rechecked} citation{a.answer.rechecked === 1 ? "" : "s"} fixed on re-check</Chip>}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

