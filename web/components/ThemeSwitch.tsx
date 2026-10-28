"use client";

import { useSyncExternalStore } from "react";

const SYSTEM = "(prefers-color-scheme: dark)";

function subscribe(changed: () => void) {
  const system = matchMedia(SYSTEM);
  system.addEventListener("change", changed);
  window.addEventListener("themechange", changed);
  return () => {
    system.removeEventListener("change", changed);
    window.removeEventListener("themechange", changed);
  };
}

const isDark = () => {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "dark" : matchMedia(SYSTEM).matches;
};

/** Light or dark (mission control). Starts from the system setting; a choice is remembered in this browser. */
export default function ThemeSwitch() {
  const dark = useSyncExternalStore(subscribe, isDark, () => null);
  function flip() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
    window.dispatchEvent(new Event("themechange"));
  }
  if (dark === null) return <span className="size-11" aria-hidden />;
  return (
    <button type="button" onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} aria-pressed={dark}
      className="hit grid size-11 place-items-center rounded-full text-lg ring-1 ring-rule transition hover:ring-scan">
      <span aria-hidden>{dark ? "☀" : "☾"}</span>
    </button>
  );
}
