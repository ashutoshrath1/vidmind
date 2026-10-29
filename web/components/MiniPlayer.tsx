"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Seek, YT_ORIGIN } from "@/components/ui";
import { formatTime } from "@/lib/api";

/** No player sits on the notes page: a timestamp or proof click opens a small floating one, playing from that second. */
export function useMiniPlayer(youtubeId: string | null, base: string, title: string, start = 0) {
  // ?t= links open the player at that second.
  const [at, setAt] = useState<{ t: number; n: number; from?: HTMLElement | null } | null>(start ? { t: start, n: 0 } : null);
  const opener = useRef<HTMLElement | null>(null);
  const seek: Seek = (t) => {
    opener.current = document.activeElement as HTMLElement | null;
    setAt((a) => ({ t, n: (a?.n ?? 0) + 1, from: a ? a.from : opener.current })); // the first opener is where it springs from
  };
  const close = () => {
    setAt(null);
    opener.current?.focus(); // back to the chip that opened it
  };
  const player = at && <MiniPlayer youtubeId={youtubeId} base={base} title={title} t={at.t} n={at.n} from={at.from ?? null} onClose={close} />;
  return { seek, player };
}

type Props = { youtubeId: string | null; base: string; title: string; t: number; n: number; from: HTMLElement | null; onClose: () => void };

function MiniPlayer({ youtubeId, base, title, t, n, from, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const yt = useRef<HTMLIFrameElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const loaded = useRef(false);
  // First open: the iframe's start/#t does it. Later seeks while open: jump the running player.
  const [first] = useState(t);

  const send = (func: string, args: unknown[] = []) =>
    yt.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), YT_ORIGIN);

  useEffect(() => {
    if (youtubeId) {
      if (!loaded.current) return;
      send("seekTo", [t, true]);
      send("playVideo");
    } else if (video.current) {
      video.current.currentTime = t;
      void video.current.play().catch(() => {});
    }
    // n: the same second clicked twice still seeks
  }, [t, n, youtubeId]);

  // Opened from a citation: start small at the citation and spring to the corner, so the eye follows it.
  const [origin] = useState(from);
  useLayoutEffect(() => {
    const el = box.current;
    const a = origin?.getBoundingClientRect();
    if (!el || !a || !a.width || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const b = el.getBoundingClientRect();
    el.style.transition = "none";
    el.style.transform = `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(0.12)`;
    el.style.opacity = "0";
    void el.offsetWidth; // commit the start pose before springing out of it
    el.style.transition = "";
    el.style.transform = "";
    el.style.opacity = "";
  }, [origin]);

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Video player, from ${formatTime(t)}`}
      tabIndex={-1}
      className="glass fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))] origin-center overflow-hidden rounded-[22px] p-1.5 shadow-2xl transition-[transform,opacity] duration-600 ease-spring outline-none motion-reduce:transition-none"
    >
      <div className="flex items-center gap-2 py-0.5 pr-0.5 pl-2.5">
        <p className="min-w-0 flex-1 truncate text-sm text-graphite">
          <span className="tabular mr-2 font-medium text-scan-ink">{formatTime(t)}</span>
          {title}
        </p>
        <button onClick={onClose} aria-label="Close player" className="hit grid size-8 place-items-center rounded-full bg-graphite/12 text-base text-graphite hover:bg-graphite/20 hover:text-ink">
          ×
        </button>
      </div>
      {youtubeId ? (
        <iframe
          ref={yt}
          src={`${YT_ORIGIN}/embed/${youtubeId}?enablejsapi=1&rel=0&autoplay=1&start=${Math.floor(first)}`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          onLoad={() => {
            loaded.current = true;
            send("seekTo", [t, true]); // start= is whole seconds; land on the exact one
            send("playVideo");
          }}
          className="aspect-video w-full rounded-2xl bg-black"
        />
      ) : (
        <video ref={video} src={`${base}/video#t=${first}`} controls autoPlay preload="metadata" className="aspect-video w-full rounded-2xl bg-black" />
      )}
    </div>
  );
}
