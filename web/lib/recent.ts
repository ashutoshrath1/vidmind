// The notes made in this browser, newest first, for the home page and the library. Kept for 24 hours: the server
// deletes each video and its notes then, and a link would only show "not found".
// at: ms since epoch, when the job was created.
export type Recent = { id: string; title: string; at: number; mode?: string };

const KEY = "vidmind-recent";
const DAY_MS = 24 * 3600 * 1000;
const CHANGED = "vidmind-recent-changed";

export function fresh(list: Recent[], now?: number): Recent[] {
  if (!list.length) return list; // the server's empty list: no clock read while prerendering
  const t = now ?? Date.now();
  // The sample is never deleted.
  return list.filter((r) => r.id && r.title && (r.id === "sample" || t - r.at < DAY_MS));
}

export function remember(list: Recent[], item: Recent, keep = 50): Recent[] {
  return [item, ...list.filter((r) => r.id !== item.id)].slice(0, keep);
}

export function readRecent(): string {
  try { return localStorage.getItem(KEY) ?? "[]"; } catch { return "[]"; }
}

export function parseRecent(raw: string): Recent[] {
  try { return fresh(JSON.parse(raw)); } catch { return []; }
}

function save(change: (list: Recent[]) => Recent[]) {
  try {
    const next = JSON.stringify(change(parseRecent(readRecent())));
    if (next === readRecent()) return;
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new Event(CHANGED));
  } catch {} // private mode or storage full: the list is a convenience, never worth an error
}

export const saveRecent = (item: Recent) => save((list) => remember(list, item));

export function subscribeRecent(changed: () => void) {
  window.addEventListener(CHANGED, changed);
  window.addEventListener("storage", changed); // another tab made notes
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener("storage", changed);
  };
}
