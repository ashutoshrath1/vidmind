"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EvidenceChip, type Seek } from "@/components/ui";
import { type Diagram, type LearnResult } from "@/lib/api";
import { toMermaid } from "@/lib/export";

const KIND = { architecture: "Architecture", flowchart: "Flow", sequence: "API flow" } as const;

function DiagramView({ diagram, base, seek }: { diagram: Diagram; base: string; seek: Seek }) {
  const box = useRef<HTMLDivElement>(null);
  const id = "d" + useId().replace(/\W/g, "");
  const [state, setState] = useState<"drawing" | "drawn" | "failed">("drawing");

  useEffect(() => {
    let live = true;
    (async () => {
      // Loaded on demand: the diagram library is large and most of the page doesn't need it.
      const { default: mermaid } = await import("mermaid");
      // Drawn in the page's theme; the panel behind it follows too.
      const chosen = document.documentElement.dataset.theme;
      mermaid.initialize(mermaidConfig(chosen ? chosen === "dark" : matchMedia("(prefers-color-scheme: dark)").matches));
      const { svg } = await mermaid.render(id, toMermaid(diagram));
      if (!live || !box.current) return;
      box.current.innerHTML = svg; // mermaid's own output under securityLevel "strict"
      setState("drawn");
    })().catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, [diagram, id]);

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-lg font-semibold">{diagram.title}</span>
        <span className="text-sm text-graphite">{KIND[diagram.kind]}, from the video</span>
      </figcaption>
      {state === "failed" ? (
        <p className="text-sm text-graphite">The diagram couldn&apos;t be drawn; its parts are listed below.</p>
      ) : (
        <div ref={box} role="img" data-diagram aria-label={`${KIND[diagram.kind]} diagram: ${diagram.title}`}
          className={`${state === "drawing" ? "scanning min-h-40" : ""} overflow-x-auto rounded-lg bg-sheet p-4 ring-1 ring-rule [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full`} />
      )}
      <details className="text-sm">
        <summary className="hit cursor-pointer text-graphite hover:text-ink">Proof for each box</summary>
        <ul className="mt-2 space-y-2">
          {diagram.nodes.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{n.text}</span>
              {n.evidence.map((e, i) => <EvidenceChip key={i} evidence={e} base={base} seek={seek} />)}
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}


/** Top of the notes: the diagram the video explains, then its checked takeaways. */
export default function Highlights({ result, base, seek }: { result: LearnResult; base: string; seek: Seek }) {
  const takeaways = result.takeaways ?? [];
  if (!takeaways.length && !result.diagram) return null;
  return (
    <section aria-label="Key takeaways" className="mb-8 space-y-6 border-b border-rule pb-8">
      {result.diagram && <DiagramView diagram={result.diagram} base={base} seek={seek} />}
      {takeaways.length > 0 && (
        <div>
          <h2 className="font-display text-xl font-semibold">Key takeaways</h2>
          <ol className="mt-3 space-y-2.5">
            {takeaways.map((t, i) => (
              <li key={i} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
                <span className="tabular font-display font-semibold text-scan-ink">{i + 1}</span>
                <p className="max-w-[70ch]">
                  {t.text}{" "}
                  <span className="inline-flex flex-wrap gap-1 align-middle">
                    {t.evidence.map((e, j) => <EvidenceChip key={j} evidence={e} base={base} seek={seek} />)}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

const SYSTEM_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

/** Mermaid in VidMind's colours, for the page (either theme). */
function mermaidConfig(dark: boolean) {
  const v = dark
    ? { primaryColor: "#17163a", primaryTextColor: "#eceeff", primaryBorderColor: "#8b7bff", lineColor: "#9aa0c3", secondaryColor: "#0f2a3a",
        tertiaryColor: "#2a1030", edgeLabelBackground: "#0b0b22", textColor: "#cfd3f5", actorBkg: "#17163a", actorBorder: "#8b7bff",
        actorTextColor: "#eceeff", signalColor: "#9aa0c3", signalTextColor: "#cfd3f5", noteBkgColor: "#1d1b45", noteTextColor: "#eceeff" }
    : { primaryColor: "#f1efff", primaryTextColor: "#1b1640", primaryBorderColor: "#5b45f0", lineColor: "#7a7fa8", secondaryColor: "#e6fbff",
        tertiaryColor: "#ffeaf6", edgeLabelBackground: "#ffffff", textColor: "#33375c", actorBkg: "#f1efff", actorBorder: "#5b45f0",
        actorTextColor: "#1b1640", signalColor: "#7a7fa8", signalTextColor: "#33375c", noteBkgColor: "#fff7d6", noteTextColor: "#1b1640" };
  return { startOnLoad: false, securityLevel: "strict" as const, theme: "base" as const, flowchart: { htmlLabels: false, curve: "basis" as const },
    themeVariables: { fontFamily: SYSTEM_FONT, fontSize: "15px", ...v } };
}
