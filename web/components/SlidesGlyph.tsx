// SF-Symbol-like line glyphs for the On screen and How it was made tabs: 24-unit grid, round caps, currentColor.
const PATHS = {
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20",
  clear: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9l6 6M15 9l-6 6",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  close: "M6 6l12 12M18 6 6 18",
  play: "M8 5.5v13l10.5-6.5L8 5.5Z",
  copy: "M9 9h10v11H9zM5 15V4h10",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  wave: "M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2",
  scenes: "M4 6h16v12H4zM9 6v12M15 6v12",
  pen: "M4 20l4-1L19 8l-3-3L5 16l-1 4ZM14 7l3 3",
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12.5l2.7 2.7L16 9.5",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16Z",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  crop: "M6 2v16h16M2 6h16v16",
  card: "M3 5h18v14H3zM7 9h6M7 13h10",
  speech: "M4 5h16v11H9l-5 4V5Z",
  notes: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
} as const;

export type GlyphName = keyof typeof PATHS;

export default function SlidesGlyph({ name, className = "size-4" }: { name: GlyphName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill={name === "play" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
