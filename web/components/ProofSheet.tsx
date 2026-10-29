"use client";

import type { Seek } from "@/components/ui";
import type { View } from "@/lib/trace";

/** Placeholder cards while scene changes are still being found; once frames exist the On screen walkthrough
 * (ScreenText) takes over. */
export default function ProofSheet({ view }: { view: View; base: string; seek: Seek }) {
  if (view.frames.length || !view.stages.scenes || view.keyframesError) return null;
  return (
    <section aria-label="On screen" className="mx-auto max-w-5xl space-y-5">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">On screen</h2>
        <p className="mt-1 text-sm text-graphite">Finding where the picture changes…</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="aspect-video animate-pulse rounded-[20px] bg-sheet shadow-sm motion-reduce:animate-none" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </ul>
    </section>
  );
}
