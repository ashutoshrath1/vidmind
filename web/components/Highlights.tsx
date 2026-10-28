"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button, EvidenceChip, type Seek } from "@/components/ui";
import { type Diagram, type LearnResult, formatTime } from "@/lib/api";
import { toLinkedIn, toMermaid, toX } from "@/lib/export";

const KIND = { architecture: "Architecture", flowchart: "Flow", sequence: "API flow" } as const;

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

function DiagramView({ diagram, base, seek, onDrawn }: { diagram: Diagram; base: string; seek: Seek; onDrawn: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const id = "d" + useId().replace(/\W/g, "");
  const [state, setState] = useState<"drawing" | "drawn" | "failed">("drawing");
  const drawnEvent = useEffectEvent(onDrawn); // not a dependency: re-drawing because the parent re-rendered is waste

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
      drawnEvent();
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

/** Top of the notes: checked takeaways, the diagram the video explains, and posts built from the takeaways. */
export default function Highlights({ result, base, seek }: { result: LearnResult; base: string; seek: Seek }) {
  const [drawn, setDrawn] = useState(false);
  const takeaways = result.takeaways ?? [];
  if (!takeaways.length && !result.diagram && !result.further?.length) return null;
  const name = result.title.replace(/[^\w-]+/g, " ").trim() || "video";
  const checks = Object.fromEntries((result.claims ?? []).map((c) => [c.claim, c]));
  return (
    <section aria-label="Key takeaways" className="mb-8 space-y-6 border-b border-rule pb-8">
      {result.diagram && <DiagramView diagram={result.diagram} base={base} seek={seek} onDrawn={() => setDrawn(true)} />}
      {takeaways.length > 0 && (
        <div>
          <h2 className="flex flex-wrap items-baseline justify-between gap-2 font-display text-xl font-semibold">
            Key takeaways
            {!!result.claims?.length && <span className="font-sans text-xs font-normal text-graphite">{tally(result.claims)}</span>}
          </h2>
          <ol className="mt-3 space-y-2.5">
            {takeaways.map((t, i) => (
              <li key={i} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
                <span className="tabular font-display font-semibold text-scan-ink">{i + 1}</span>
                <p className="max-w-[70ch]">
                  {checks[t.text] && <Verdict check={checks[t.text]} />}
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
      {takeaways.length > 0 && (!result.diagram || drawn) && <Share result={result} name={name} />}
      {!!result.further?.length && (
        <div>
          <h3 className="font-display font-semibold">Go deeper <span className="text-sm font-normal text-graphite">from a web search, not the video</span></h3>
          <ul className="mt-2 divide-y divide-rule rounded-lg ring-1 ring-rule">
            {result.further.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 bg-sheet px-4 py-2.5 hover:bg-lightbox">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold group-hover:text-scan-ink">{l.title}</span>
                    <span className="block truncate text-xs text-graphite">{new URL(l.url).hostname.replace(/^www\./, "")}: {l.why}</span>
                  </span>
                  <span aria-hidden className="text-graphite group-hover:text-scan-ink">↗</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return line ? [...lines, line] : lines;
}

/** Lines of about equal length: the narrowest width that still needs no more lines, so no word sits alone. */
function balanced(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const base = wrap(ctx, text, width);
  let best = base;
  for (let w = width - 8; base.length > 1 && w > width * 0.5; w -= 8) {
    const lines = wrap(ctx, text, w);
    if (lines.length !== base.length) break;
    best = lines;
  }
  return best;
}

const SPECTRUM = ["#3ee8ff", "#8b7bff", "#ff5cc8"];
// Diagram labels in an SVG drawn to a canvas can't use the page's web fonts, so the diagram uses system ones.
const SYSTEM_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

/** Mermaid in VidMind's colours, for the page (either theme) and the post image (always dark). */
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

/** The diagram, drawn again in the dark brand theme, as an image the post canvas can paint. */
async function diagramImage(d: Diagram) {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize(mermaidConfig(true));
  const { svg } = await mermaid.render(`post${Date.now()}`, toMermaid(d));
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const [, , width, height] = (doc.getAttribute("viewBox") ?? "0 0 600 300").split(/\s+/).map(Number);
  doc.setAttribute("width", String(width * 2)); // an intrinsic size, so it rasterises sharply
  doc.setAttribute("height", String(height * 2));
  doc.removeAttribute("style");
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(doc));
  await img.decode();
  return { img, width, height };
}

/** The VidMind prism mark (as in the header logo), at x, y, size px. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 32, size / 32);
  const grad = (x0: number, y0: number, x1: number, y1: number, a: string, b: string) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    return g;
  };
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.stroke(new Path2D("M1.5 16h8"));
  ctx.fillStyle = grad(9, 4.5, 28, 16, "#3ee8ff", "#8b7bff");
  ctx.fill(new Path2D("M9 4.5 28 16H15.5z"));
  ctx.fillStyle = grad(9, 27.5, 28, 16, "#6d4aff", "#ff5cc8");
  ctx.fill(new Path2D("M9 27.5 28 16H15.5z"));
  ctx.fillStyle = grad(9, 16, 15.5, 16, "#ffffff", "#c9f6ff");
  ctx.fill(new Path2D("M9 4.5 15.5 16 9 27.5z"));
  ctx.restore();
}

/** The post image, 1080x1350 (4:5, the largest a feed shows), in VidMind's look: the mark, the title, what was
 * checked, the diagram, and the takeaways with the second each came from. Everything on it is from the checked result. */
async function postImage(r: LearnResult): Promise<Blob> {
  const W = 1080, H = 1350, M = 72, inner = W - 2 * M;
  const css = getComputedStyle(document.documentElement);
  const family = (v: string, fallback: string) => css.getPropertyValue(v).trim() || fallback;
  const DISPLAY = family("--font-grotesk", "system-ui"), BODY = family("--font-geist", "system-ui"), MONO = family("--font-jetbrains", "ui-monospace");
  await Promise.all([`600 64px ${DISPLAY}`, `500 30px ${BODY}`, `500 22px ${MONO}`].map((f) => document.fonts.load(f).catch(() => [])));
  const diagram = r.diagram ? await diagramImage(r.diagram).catch(() => null) : null;

  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d")!;
  const panel = (x: number, y: number, w: number, h: number, rad: number, fill = "rgba(255,255,255,0.05)", edge: string | CanvasGradient = "rgba(255,255,255,0.1)") => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const spectrum = (x0: number, x1: number) => {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    SPECTRUM.forEach((c, i) => g.addColorStop(i / 2, c));
    return g;
  };

  // Deep space with the three spectrum glows and a faint grid.
  ctx.fillStyle = "#05060f";
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, rad, rgb, a] of [[W * 0.08, 120, 560, "62,232,255", 0.2], [W * 0.98, H * 0.36, 600, "139,123,255", 0.28], [W * 0.1, H * 0.98, 620, "255,92,200", 0.2]] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.strokeStyle = "rgba(160,166,220,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Header: the mark and name, and what VidMind does.
  drawMark(ctx, M, M - 2, 44);
  ctx.fillStyle = "#fff";
  ctx.font = `600 34px ${DISPLAY}`;
  ctx.fillText("VidMind", M + 58, M + 32);
  ctx.font = `500 22px ${BODY}`;
  const tag = "Notes with proof";
  const tw = ctx.measureText(tag).width + 40;
  panel(W - M - tw, M - 2, tw, 46, 23, "rgba(255,255,255,0.06)", spectrum(W - M - tw, W - M));
  ctx.fillStyle = "rgba(236,238,255,0.9)";
  ctx.fillText(tag, W - M - tw + 20, M + 29);
  let y = M + 44 + 56;

  // Title: as large as fits in three balanced lines.
  let size = 66;
  let lines: string[];
  for (;;) {
    ctx.font = `600 ${size}px ${DISPLAY}`;
    ctx.letterSpacing = `${-size * 0.02}px`;
    lines = balanced(ctx, r.title, inner);
    if (lines.length <= 3 || size <= 46) break;
    size -= 4;
  }
  ctx.fillStyle = "#fff";
  for (const line of lines.slice(0, 3)) {
    ctx.fillText(line, M, y + size * 0.82);
    y += size * 1.06;
  }
  ctx.letterSpacing = "0px";
  y += 26;

  // What was checked, as chips with drawn icons (emoji render differently on every system).
  const notes = r.chapters.reduce((n, c) => n + c.notes.length, 0);
  const icon = (kind: string, cx: number, cy: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (kind === "check") {
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#05060f";
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy);
      ctx.lineTo(cx - 1, cy + 4);
      ctx.lineTo(cx + 6, cy - 4);
    } else if (kind === "clock") {
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + 4, cy + 3);
    } else for (const dy of [-6, 0, 6]) { ctx.moveTo(cx - 8, cy + dy); ctx.lineTo(cx + 8, cy + dy); }
    ctx.stroke();
  };
  let x = M;
  ctx.font = `500 24px ${BODY}`;
  for (const [kind, color, text] of [["check", "#34d399", `${notes} notes proven`], ["clock", "#3ee8ff", `${formatTime(r.duration_seconds)} video`],
    ["list", "#ff5cc8", `${(r.takeaways ?? []).length} takeaways`]] as const) {
    const w = ctx.measureText(text).width + 74;
    panel(x, y, w, 50, 25, "rgba(255,255,255,0.06)");
    icon(kind, x + 28, y + 25, color);
    ctx.fillStyle = "#eceeff";
    ctx.fillText(text, x + 50, y + 33);
    x += w + 12;
  }
  y += 50 + 34;

  // The diagram on a glass card with a spectrum edge.
  if (diagram) {
    const k = Math.min((inner - 56) / diagram.width, 290 / diagram.height);
    const h = diagram.height * k + 56;
    panel(M, y, inner, h, 28, "rgba(255,255,255,0.04)", spectrum(M, W - M));
    ctx.drawImage(diagram.img, M + (inner - diagram.width * k) / 2, y + 28, diagram.width * k, diagram.height * k);
    y += h + 26;
  }

  // Takeaways, whole ones only, each with the second it came from and the web check when it confirmed the point.
  for (const [i, t] of (r.takeaways ?? []).entries()) {
    ctx.font = `500 28px ${BODY}`;
    const text = wrap(ctx, t.text, inner - 120);
    const h = 22 + text.length * 37 + 42;
    if (y + h > H - 118) break;
    panel(M, y, inner, h, 22);
    ctx.fillStyle = SPECTRUM[i % 3];
    ctx.beginPath();
    ctx.arc(M + 44, y + 44, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#05060f";
    ctx.font = `600 24px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), M + 44, y + 52);
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = `500 28px ${BODY}`;
    text.forEach((line, j) => ctx.fillText(line, M + 88, y + 50 + j * 37));
    const meta = y + 50 + text.length * 37 + 4;
    ctx.font = `500 21px ${MONO}`;
    const second = t.evidence.length ? Math.min(...t.evidence.map((e) => e.start_seconds)) : null;
    let mx = M + 88;
    if (second !== null) {
      ctx.fillStyle = "#3ee8ff";
      const s = `▶ ${formatTime(second)} in the video`;
      ctx.fillText(s, mx, meta);
      mx += ctx.measureText(s).width + 24;
    }
    if (r.claims?.some((c) => c.verdict === "confirmed" && c.claim.trim() === t.text.trim())) {
      ctx.fillStyle = "#34d399";
      ctx.fillText("✓ confirmed on the web", mx, meta);
    }
    y += h + 12;
  }

  // Footer.
  ctx.fillStyle = spectrum(M, W - M);
  ctx.fillRect(M, H - 100, inner, 2);
  drawMark(ctx, M, H - 74, 28);
  ctx.fillStyle = "rgba(236,238,255,0.8)";
  ctx.font = `500 22px ${BODY}`;
  ctx.fillText("Every point checked against the video", M + 42, H - 53);
  ctx.textAlign = "right";
  ctx.fillText("Made with VidMind", W - M, H - 53);
  ctx.textAlign = "left";
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("image failed"))), "image/png"));
}

const COMPOSE = {
  linkedin: (text: string) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
  x: (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
};

/** Post buttons: the image plus text built only from the checked takeaways. Phones get the share sheet (image and
 * text together); elsewhere the text is copied, the image saved, and the site's compose box opened with the text. */
function Share({ result, name }: { result: LearnResult; name: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);

  // Built once the diagram is on the page, so the preview is exactly what gets posted.
  useEffect(() => {
    let url = "";
    postImage(result).then((blob) => {
      url = URL.createObjectURL(blob);
      setImage({ blob, url });
    }).catch(() => setNote("Couldn't draw the post image."));
    return () => URL.revokeObjectURL(url);
  }, [result]);

  async function post(site: keyof typeof COMPOSE) {
    if (!image) return;
    const text = site === "x" ? toX(result) : toLinkedIn(result);
    const file = new File([image.blob], `${name}.png`, { type: "image/png" });
    if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text }); // phones: image and text straight into the app
      } catch {}
      return;
    }
    const where = site === "x" ? "X" : "LinkedIn";
    const paste = navigator.platform.includes("Mac") ? "⌘V" : "Ctrl+V";
    // Copy first, while this page still has focus: once the post opens in a new tab the browser refuses the copy.
    let copied = true;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]);
    } catch {
      copied = false;
      save(file.name, file); // this browser can't copy images: save it instead
    }
    const tab = window.open(COMPOSE[site](text), "_blank"); // the text arrives pre-filled
    if (tab) tab.opener = null; // the post page can't reach back into this one
    setNote(!tab ? "Allow pop-ups for this page to open the post."
      : copied ? `Image copied. Click into the ${where} post and press ${paste} to add it.`
      : `Image saved as ${file.name}. Attach it in the ${where} post.`);
  }

  return (
    <div className="space-y-3">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob, made on this page
        <img src={image.url} alt="The image that will be posted" className="arrive w-full max-w-sm rounded-xl shadow-lg ring-1 ring-rule" />
      ) : (
        <div className="scanning aspect-[4/5] w-full max-w-sm rounded-xl bg-lightbox" aria-label="Drawing the post image" />
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => post("linkedin")} disabled={!image}>Post on LinkedIn</Button>
        <Button onClick={() => post("x")} disabled={!image}>Post on X</Button>
      </div>
      <p className="text-sm text-graphite" role="status">
        {note ?? "The text is filled in for you and the image is copied: paste it into the post (⌘V or Ctrl+V). Both use only checked points."}
      </p>
    </div>
  );
}

type Claim = NonNullable<LearnResult["claims"]>[number];
const VERDICT = {
  confirmed: ["✓ Confirmed", "bg-proof-soft text-proof"],
  outdated: ["⚠ Outdated", "bg-scan-soft text-scan-ink"],
  disputed: ["✗ Disputed", "bg-strike-soft text-strike"],
  unclear: ["? Unclear", "bg-lightbox text-graphite"],
} as const;

const tally = (claims: Claim[]) =>
  "Checked against the web: " + (["confirmed", "outdated", "disputed", "unclear"] as const)
    .map((v) => [v, claims.filter((c) => c.verdict === v).length] as const).filter(([, n]) => n).map(([v, n]) => `${n} ${v}`).join(", ");

/** The web's verdict on a takeaway. Outdated or disputed ones say why, with the sources, right under the point. */
function Verdict({ check }: { check: Claim }) {
  const [label, tone] = VERDICT[check.verdict];
  const flagged = check.verdict === "outdated" || check.verdict === "disputed";
  return (
    <>
      <span title={check.why} className={`mr-1.5 inline-block rounded-full px-1.5 py-px align-middle text-[11px] font-semibold ${tone}`}>{label}</span>
      {flagged && (
        <span className="mb-1 block text-xs text-graphite">
          {check.why}{" "}
          {check.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="hit text-scan-ink underline underline-offset-2">{new URL(s.url).hostname.replace(/^www\./, "")} ↗</a>
          ))}
        </span>
      )}
    </>
  );
}
