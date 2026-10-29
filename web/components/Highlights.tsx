"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Cite, NoteLine } from "@/components/Cite";
import type { Seek } from "@/components/ui";
import { type Diagram, type LearnResult } from "@/lib/api";
import { toMermaid } from "@/lib/export";

const KIND = { architecture: "Architecture", flowchart: "Flow", sequence: "API flow" } as const;

function DiagramView({ diagram, seek }: { diagram: Diagram; seek: Seek }) {
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
    <figure className="mt-12">
      {state === "failed" ? (
        <p className="text-base text-graphite">The diagram couldn&apos;t be drawn; its parts are listed below.</p>
      ) : (
        <div ref={box} role="img" data-diagram aria-label={`${KIND[diagram.kind]} diagram: ${diagram.title}`}
          className={`${state === "drawing" ? "scanning min-h-40" : ""} overflow-x-auto rounded-2xl bg-sheet p-4 sm:p-6 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full`} />
      )}
      <figcaption className="mt-3 text-center font-sans text-sm text-graphite">
        {diagram.title} <span>({KIND[diagram.kind].toLowerCase()} from the video)</span>
      </figcaption>
      <details className="mt-1 text-center font-sans text-sm">
        <summary className="hit cursor-pointer text-graphite hover:text-ink">Where each box comes from</summary>
        <ul className="mt-2 space-y-1 text-left">
          {diagram.nodes.map((n) => (
            <li key={n.id}>
              <span className="font-semibold">{n.text}</span>
              {n.evidence.map((e, i) => <Cite key={i} evidence={e} seek={seek} />)}
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}

/** Top of the article: the checked takeaways, then the diagram the video explains. */
export default function Highlights({ result, seek }: { result: LearnResult; seek: Seek }) {
  const takeaways = result.takeaways ?? [];
  if (!takeaways.length && !result.diagram) return null;
  return (
    <section aria-label="Key takeaways" className="mb-14">
      {takeaways.length > 0 && (
        <>
          <h2 className="font-display text-[1.625rem] font-semibold tracking-[-0.02em] sm:text-[2rem]">Key takeaways</h2>
          <ol className="mt-4 divide-y divide-rule">
            {takeaways.map((t, i) => (
              <li key={i} className="flex gap-4 py-4"><span aria-hidden className="tabular pt-1 font-display text-[0.9375rem] font-semibold text-scan-ink">{i + 1}</span><span className="min-w-0"><NoteLine note={t} seek={seek} /></span></li>
            ))}
          </ol>
        </>
      )}
      {result.diagram && <DiagramView diagram={result.diagram} seek={seek} />}
    </section>
  );
}

const SYSTEM_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

/** Mermaid in VidMind's colours, for the page (either theme). */
function mermaidConfig(dark: boolean) {
  const v = dark
    ? { primaryColor: "#2c2c2e", primaryTextColor: "#f5f5f7", primaryBorderColor: "#2997ff", lineColor: "#8e8e93", secondaryColor: "#2c2c2e",
        tertiaryColor: "#1c1c1e", edgeLabelBackground: "#1c1c1e", textColor: "#d1d1d6", actorBkg: "#2c2c2e", actorBorder: "#2997ff",
        actorTextColor: "#f5f5f7", signalColor: "#8e8e93", signalTextColor: "#d1d1d6", noteBkgColor: "#3a3a3c", noteTextColor: "#f5f5f7" }
    : { primaryColor: "#f5f5f7", primaryTextColor: "#1d1d1f", primaryBorderColor: "#0071e3", lineColor: "#86868b", secondaryColor: "#f5f5f7",
        tertiaryColor: "#ffffff", edgeLabelBackground: "#ffffff", textColor: "#424245", actorBkg: "#f5f5f7", actorBorder: "#0071e3",
        actorTextColor: "#1d1d1f", signalColor: "#86868b", signalTextColor: "#424245", noteBkgColor: "#fff9db", noteTextColor: "#1d1d1f" };
  return { startOnLoad: false, securityLevel: "strict" as const, theme: "base" as const, flowchart: { htmlLabels: false, curve: "basis" as const },
    themeVariables: { fontFamily: SYSTEM_FONT, fontSize: "15px", ...v } };
}
