"use client";

import Icon from "@/components/Icon";
import { useRef } from "react";

/** What VidMind does, as one 3D scene: the video at the back; a keyframe whose diagram the segmentation model
 * outlines; a sentence heard at 0:22 lifting out; and the note they become, stamped Proven with both proofs.
 * Follows the pointer, drifts while idle, loops every 6 s, and is a complete still under reduced motion. */
export default function Hero3D() {
  const stage = useRef<HTMLDivElement>(null);

  function tilt(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    stage.current?.style.setProperty("--ry", `${-16 + ((e.clientX - r.left) / r.width - 0.5) * 22}deg`);
    stage.current?.style.setProperty("--rx", `${8 - ((e.clientY - r.top) / r.height - 0.5) * 12}deg`);
  }
  function rest() {
    stage.current?.style.removeProperty("--ry");
    stage.current?.style.removeProperty("--rx");
  }

  return (
    <figure className="@container space-y-3">
      <div
        role="img"
        aria-label="Illustration: VidMind outlines a diagram on a slide, hears “producers write to brokers” at 0:22, and turns both into a note stamped Proven."
        onPointerMove={tilt}
        onPointerLeave={rest}
        className="relative mx-auto aspect-[6/5] w-full touch-pan-y [perspective:1600px]"
      >
        <div className="float-3d absolute inset-0">
          <div ref={stage} className="stage-3d absolute inset-0">
            {/* The video */}
            <div className="depth absolute top-[2%] left-0 aspect-video w-[70%] overflow-hidden rounded-lg bg-gradient-to-br from-[#1f2937] to-[#0b1220]" style={{ transform: "translateZ(-120px)" }}>
              <div className="absolute inset-x-[5%] bottom-[9%]">
                <div className="relative h-[0.35cqw] min-h-0.5 rounded-full bg-white/20">
                  <div className="absolute inset-y-0 left-0 w-[37%] rounded-full bg-scan" />
                  <span className="absolute top-1/2 left-[37%] size-[1.4cqw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_var(--scan)]" />
                </div>
                <p className="mt-[1.4cqw] flex justify-between font-mono text-[2cqw] text-white/60"><span>0:22</span><span>1:00</span></p>
              </div>
            </div>

            {/* A keyframe with a diagram; the segmentation model outlines it */}
            <div className="depth absolute top-[30%] left-[6%] aspect-video w-[50%] overflow-hidden rounded bg-white p-[2.4cqw] font-[system-ui] text-[#111827]" style={{ transform: "translateZ(-20px)" }}>
              <p className="text-[3cqw] font-semibold">How messages flow</p>
              <div className="relative mt-[2.4cqw] flex items-center justify-between gap-[1cqw] text-[2.1cqw] font-semibold">
                {["Producer", "Broker", "Consumer"].map((b, i) => (
                  <span key={b} className="contents">
                    {i > 0 && <span className="h-px flex-1 bg-[#6b7280]" />}
                    <span className="rounded bg-[#eef2ff] px-[1cqw] py-[0.8cqw] ring-1 ring-[#c7d2fe]">{b}</span>
                  </span>
                ))}
                <span className="loop-mark pointer-events-none absolute -inset-[1.2cqw] rounded-md ring-[0.5cqw] ring-scan" />
              </div>
              <span className="loop-beam pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,transparent_35%,rgb(139_123_255/0.3)_50%,transparent_65%)]" />
              <span className="absolute right-[1.6cqw] bottom-[1.2cqw] font-mono text-[1.7cqw] text-[#6b7280]">0:31</span>
            </div>

            {/* What was heard, lifting out */}
            <div className="absolute top-[82%] left-[12%] w-[60%]" style={{ transform: "translateZ(130px)" }}>
              <p className="loop-lift depth rounded-md bg-sheet px-[2.4cqw] py-[1.6cqw] text-[2.4cqw] ring-1 ring-rule">
                <span className="font-mono text-scan-ink">Heard at 0:22 </span>
                <span className="marker">“producers write to brokers”</span>
              </p>
            </div>

            {/* The note, with both proofs */}
            <div className="absolute top-[12%] left-[52%] w-[48%]" style={{ transform: "translateZ(210px)" }}>
              <div className="loop-note depth relative rounded-lg bg-sheet p-[3cqw] ring-1 ring-rule">
                <p className="pr-[2cqw] font-display text-[3.6cqw] leading-snug">Producers write to brokers; consumers read from them.</p>
                <p className="mt-[2cqw] flex flex-wrap gap-[1.2cqw] font-mono text-[2.2cqw]">
                  <span className="rounded-full bg-lightbox px-[1.6cqw] py-[0.4cqw] ring-1 ring-rule">“ 0:22</span>
                  <span className="rounded-full bg-lightbox px-[1.6cqw] py-[0.4cqw] ring-1 ring-rule">▣ 0:31</span>
                </p>
                <span className="loop-stamp absolute -top-[3cqw] -right-[2cqw] rounded-md border-2 border-proof bg-sheet px-[1.6cqw] font-display text-[3.2cqw] font-bold text-proof shadow-md">
                  Proven
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="flex flex-wrap justify-center gap-2 text-xs text-graphite">
        {([["listen", "listens"], ["watch", "watches"], ["frame", "finds diagrams"], ["check", "proves"]] as const).map(([icon, t]) => (
          <span key={t} className="flex items-center gap-1.5 rounded-full bg-sheet px-2.5 py-1 ring-1 ring-rule"><Icon name={icon} className="size-3.5 text-scan-ink" />{t}</span>
        ))}
      </figcaption>
    </figure>
  );
}
