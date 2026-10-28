import type { Metadata, ResolvingMetadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LandFlash } from "@/components/Ambient";
import JobView from "@/components/JobView";
import { type LearnResult, jobUrl } from "@/lib/api";

/** A shared link previews as the video's title and summary, read from the finished result. */
export async function generateMetadata({ params }: PageProps<"/jobs/[id]">, parent: ResolvingMetadata): Promise<Metadata> {
  const { id } = await params;
  if (!/^(sample|[0-9a-f]{32})$/.test(id)) return {}; // only real job ids reach the API
  try {
    const r = await fetch(`${jobUrl(id)}/result`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return {};
    const result: LearnResult = await r.json();
    const title = `${result.title} | VidMind`;
    const said = result.tldr || "Notes from the video, each point linked to the second it came from.";
    const description = said.length > 200 ? `${said.slice(0, 199).trimEnd()}…` : said;
    const { openGraph, twitter } = await parent; // a child's openGraph replaces the parent's, image included
    return {
      title,
      description,
      openGraph: { title, description, type: "article", images: openGraph?.images },
      twitter: { card: "summary_large_image", title, description, images: twitter?.images },
    };
  } catch {
    return {};
  }
}

// The metadata waits on the API at request time; this marks that as intended while the shell still prerenders.
async function Connection() {
  await connection();
  return null;
}

export default function JobPage() {
  // The job id is only known at request time, so the client view that reads it must sit inside Suspense.
  return (
    <>
      <LandFlash />
      <Suspense fallback={<p className="p-8 text-graphite">Loading…</p>}>
        <JobView />
      </Suspense>
      <Suspense>
        <Connection />
      </Suspense>
    </>
  );
}
