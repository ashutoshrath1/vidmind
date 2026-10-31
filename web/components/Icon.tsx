// One stroked icon set (24px grid, 1.75 stroke), so icons share a style instead of mixing platform emoji.
const PATHS = {
  listen: <><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></>,
  watch: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  frame: <><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="8" y="8" width="8" height="8" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  diagram: <><rect x="3" y="3" width="7" height="5" rx="1" /><rect x="14" y="16" width="7" height="5" rx="1" /><path d="M6.5 8v4h11v4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  replay: <><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v4h4" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
} as const;

export type IconName = keyof typeof PATHS;

/** Decorative by default (hidden from screen readers); pass a label when the icon carries meaning on its own. */
export default function Icon({ name, className = "size-4", label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {PATHS[name]}
    </svg>
  );
}
