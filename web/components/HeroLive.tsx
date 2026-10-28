"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Hero3D from "@/components/Hero3D";

// three.js loads only here, after the page is up, and never for people who asked for less motion.
const HeroScene = dynamic(() => import("@/components/HeroScene"), { ssr: false, loading: () => null });

const REDUCED = "(prefers-reduced-motion: reduce)";
let webgl: boolean | undefined; // checked once: can this browser draw the 3D scene at all?
const hasWebGL = () => (webgl ??= (() => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
})());
const subscribe = (changed: () => void) => {
  const m = matchMedia(REDUCED);
  m.addEventListener("change", changed);
  return () => m.removeEventListener("change", changed);
};

// The scene is drawn differently on a light page, so it follows the theme switch and the system setting.
const DARK = "(prefers-color-scheme: dark)";
const isLight = () => {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "light" : !matchMedia(DARK).matches;
};
const subscribeTheme = (changed: () => void) => {
  const watch = new MutationObserver(changed);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const m = matchMedia(DARK);
  m.addEventListener("change", changed);
  return () => {
    watch.disconnect();
    m.removeEventListener("change", changed);
  };
};

/** The home backdrop: a full-screen WebGL prism scene, or the CSS scene under reduced motion and without WebGL.
 * `launch` plays the warp dive into the prism that carries the page to the result. */
export default function HeroLive({ launch = false }: { launch?: boolean }) {
  // Less motion requested, or no WebGL: the CSS scene instead (one picture, never both).
  const reduced = useSyncExternalStore(subscribe, () => matchMedia(REDUCED).matches || !hasWebGL(), () => true);
  // Stops drawing while the page is hidden (visited pages stay alive in the background).
  const light = useSyncExternalStore(subscribeTheme, isLight, () => false);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!box.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(box.current);
    return () => io.disconnect();
  }, [reduced]);
  if (reduced) return <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[45%] items-center pr-8 lg:flex"><Hero3D /></div>;
  return (
    <div ref={box} role="img" className="absolute inset-0"
      aria-label="Animation: video frames stream into a glass prism, which splits them into three beams of light carrying checked notes.">
      <HeroScene active={visible} launch={launch} light={light} />
    </div>
  );
}
