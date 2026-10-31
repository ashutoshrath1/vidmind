"use client";

import QRCode from "qrcode";
import { useState } from "react";
import { DoneMark } from "@/components/ui";

import type { LearnResult } from "@/lib/api";

const BAND = 240; // the footer band added under the card in the download, at the card's 1920 px width

/** The card as a share image: the Muse Image card, then a band with the VidMind line and a QR code to these notes. Drawn in
 * the browser; the QR points at this page's own address, so it works wherever VidMind is hosted. */
async function shareImage(src: string): Promise<string> {
  const card = await createImageBitmap(await (await fetch(src)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = card.width;
  canvas.height = card.height + BAND;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(card, 0, 0);
  const url = location.origin + location.pathname;
  const qr = new Image();
  qr.src = await QRCode.toDataURL(url, { margin: 0, width: BAND - 64, color: { dark: "#111111", light: "#ffffff" } });
  await qr.decode();
  const pad = 64;
  g.drawImage(qr, canvas.width - pad - qr.width, card.height + 32);
  g.fillStyle = "#111111";
  g.font = "600 52px -apple-system, system-ui, sans-serif";
  g.fillText("Notes with proof, by VidMind", pad, card.height + 104); // the card above already carries the title
  g.fillStyle = "#555555";
  g.font = "400 36px -apple-system, system-ui, sans-serif";
  g.fillText("Every point checked against the video. Scan for the notes.", pad, card.height + 168);
  return canvas.toDataURL("image/png");
}

/** The Muse Image card. The server reads its text back and only keeps it if it matches the checked result. */
export function SummaryCard({ result, base }: { result: LearnResult; base: string }) {
  const [said, setSaid] = useState<{ what: "saved" | "linked" | "failed" } | null>(null);
  if (!result.card_url) return null;
  const src = `${base}/${result.card_url}`;
  const flash = (what: "saved" | "linked" | "failed") => {
    setSaid({ what });
    setTimeout(() => setSaid(null), 2000);
  };
  async function download() {
    try {
      const a = document.createElement("a");
      a.href = await shareImage(src);
      a.download = `${result.title.replace(/[^\w -]+/g, "").trim() || "vidmind"} - VidMind.png`;
      a.click();
      flash("saved");
    } catch {
      flash("failed");
    }
  }
  const copyLink = () => navigator.clipboard.writeText(location.origin + location.pathname).then(() => flash("linked"), () => flash("failed"));
  return (
    <figure className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API host */}
      <img src={src} alt={`Summary card: ${result.title}`} width={1920} height={1280} loading="lazy"
        className="h-auto w-full rounded-2xl shadow-[0_8px_30px_rgb(0_0_0/0.12)]" />
      <figcaption className="flex flex-wrap items-center justify-between gap-3 text-sm text-graphite">
        <span>Its text was read back and matches the notes.</span>
        <span className="flex shrink-0 items-center gap-4" aria-live="polite">
          {said?.what === "failed" && <span className="text-strike">Couldn&apos;t do that. Try again.</span>}
          <button onClick={copyLink} className="hit font-medium text-scan-ink hover:underline">
            {said?.what === "linked" ? <DoneMark>Link copied</DoneMark> : "Copy link"}
          </button>
          <button onClick={download} className="hit font-medium text-scan-ink hover:underline">
            {said?.what === "saved" ? <DoneMark>Saved</DoneMark> : "Download"}
          </button>
        </span>
      </figcaption>
    </figure>
  );
}
