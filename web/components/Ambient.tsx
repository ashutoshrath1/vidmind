"use client";

import { useEffect, useSyncExternalStore } from "react";

/** The backdrop every page shares: drifting spectrum light, film grain, and a soft light that follows the pointer
 * (CSS reads the position, so React never re-renders for it). */
export default function Ambient() {
  useEffect(() => {
    const move = (e: PointerEvent) => {
      document.documentElement.style.setProperty("--sx", `${e.clientX}px`);
      document.documentElement.style.setProperty("--sy", `${e.clientY}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  return (
    <>
      <div className="aurora print:hidden" aria-hidden><span /><span /><span /></div>
      <div className="spotlight print:hidden" aria-hidden />
    </>
  );
}

const LAUNCHED = "vidmind-launched";
export const markLaunch = () => { try { sessionStorage.setItem(LAUNCHED, "1"); } catch {} };
const noop = () => () => {};

/** After a launch from the home page, the result page fades in out of the same flash of light. */
export function LandFlash() {
  const launched = useSyncExternalStore(noop, () => { try { return sessionStorage.getItem(LAUNCHED) === "1"; } catch { return false; } }, () => false);
  useEffect(() => {
    if (!launched) return;
    const id = setTimeout(() => { try { sessionStorage.removeItem(LAUNCHED); } catch {} }, 900);
    return () => clearTimeout(id);
  }, [launched]);
  return launched ? <div className="land-flash" aria-hidden /> : null;
}
