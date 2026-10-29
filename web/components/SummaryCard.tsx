"use client";

import type { LearnResult } from "@/lib/api";

/** The Muse Image card. The server reads its text back and only keeps it if it matches the checked result. */
export function SummaryCard({ result, base }: { result: LearnResult; base: string }) {
  if (!result.card_url) return null;
  const src = `${base}/${result.card_url}`;
  return (
    <figure className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API host */}
      <img src={src} alt={`Summary card: ${result.title}`} className="w-full rounded-2xl shadow-[0_8px_30px_rgb(0_0_0/0.12)]" />
      <figcaption className="flex items-center justify-between gap-3 text-sm text-graphite">
        <span>Its text was read back and matches the notes.</span>
        <a href={src} download className="hit shrink-0 font-medium text-scan-ink hover:underline">Download</a>
      </figcaption>
    </figure>
  );
}
