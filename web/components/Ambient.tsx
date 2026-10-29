"use client";

import { useEffect, useSyncExternalStore } from "react";

/** The backdrop every page shares. Apple pages are calm: the page colour is the backdrop, so this draws nothing. */
export default function Ambient() {
  return null;
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
