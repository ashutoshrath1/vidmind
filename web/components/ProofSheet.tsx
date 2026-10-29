"use client";

import type { Seek } from "@/components/ui";
import type { View } from "@/lib/trace";

/** Placeholder cards while scene changes are still being found; once frames exist the On screen gallery
 * (ScreenText) shows them, scanning each until its text is read. */
export default function ProofSheet({ view }: { view: View; base: string; seek: Seek }) {
  if (view.frames.length || !view.stages.scenes || view.keyframesError) return null;
  return (
    <section aria-label="On screen" className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">On screen</h2>
        <p className="text-xs text-graphite">Finding the screens the video showed</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => <li key={i} className="scanning glass aspect-video rounded-2xl ring-1 ring-rule" />)}
      </ul>
    </section>
  );
}
