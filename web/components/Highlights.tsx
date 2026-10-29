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
    <figure className="mt-10">
      {state === "failed" ? (
        <p className="text-base text-graphite">The diagram couldn&apos;t be drawn; its parts are listed below.</p>
      ) : (
        <div ref={box} role="img" data-diagram aria-label={`${KIND[diagram.kind]} diagram: ${diagram.title}`}
          className={`${state === "drawing" ? "scanning min-h-40 rounded-lg" : ""} overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full`} />
      )}
      <figcaption className="mt-3 text-center text-base text-graphite">
        {diagram.title} <span className="text-sm">({KIND[diagram.kind].toLowerCase()} from the video)</span>
      </figcaption>
      <details className="mt-2 text-center text-sm">
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
          <h2 className="font-display text-[1.6rem] font-bold sm:text-[1.875rem]">Key takeaways</h2>
          <ul className="mt-4 list-disc space-y-2.5 pl-6 marker:text-scan">
            {takeaways.map((t, i) => (
              <li key={i} className="pl-1"><NoteLine note={t} seek={seek} /></li>
            ))}
          </ul>
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
    ? { primaryColor: "#17163a", primaryTextColor: "#eceeff", primaryBorderColor: "#8b7bff", lineColor: "#9aa0c3", secondaryColor: "#0f2a3a",
        tertiaryColor: "#2a1030", edgeLabelBackground: "#0b0b22", textColor: "#cfd3f5", actorBkg: "#17163a", actorBorder: "#8b7bff",
        actorTextColor: "#eceeff", signalColor: "#9aa0c3", signalTextColor: "#cfd3f5", noteBkgColor: "#1d1b45", noteTextColor: "#eceeff" }
    : { primaryColor: "#f1efff", primaryTextColor: "#1b1640", primaryBorderColor: "#5b45f0", lineColor: "#7a7fa8", secondaryColor: "#e6fbff",
        tertiaryColor: "#ffeaf6", edgeLabelBackground: "#ffffff", textColor: "#33375c", actorBkg: "#f1efff", actorBorder: "#5b45f0",
        actorTextColor: "#1b1640", signalColor: "#7a7fa8", signalTextColor: "#33375c", noteBkgColor: "#fff7d6", noteTextColor: "#1b1640" };
  return { startOnLoad: false, securityLevel: "strict" as const, theme: "base" as const, flowchart: { htmlLabels: false, curve: "basis" as const },
    themeVariables: { fontFamily: SYSTEM_FONT, fontSize: "15px", ...v } };
}
