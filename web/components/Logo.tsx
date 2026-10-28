import Link from "next/link";

/** The mark on its own: a play button that is also a glass prism. A beam of light (the video) enters on the left;
 * the facets carry the spectrum the notes come out in. Shared by the header, the favicon and the share card. */
export function PrismMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id="vm-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3ee8ff" /><stop offset="1" stopColor="#8b7bff" /></linearGradient>
        <linearGradient id="vm-bottom" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6d4aff" /><stop offset="1" stopColor="#ff5cc8" /></linearGradient>
        <linearGradient id="vm-face" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#c9f6ff" /></linearGradient>
      </defs>
      <path className="logo-beam" d="M1.5 16h8" stroke="url(#vm-face)" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 4.5 28 16H15.5z" fill="url(#vm-top)" />
      <path d="M9 27.5 28 16H15.5z" fill="url(#vm-bottom)" />
      <path d="M9 4.5 15.5 16 9 27.5z" fill="url(#vm-face)" opacity="0.92" />
      <path d="M9 4.5 15.5 16 9 27.5M15.5 16H28" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.6" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <Link href="/" aria-label="VidMind home" className="logo hit inline-flex items-center gap-2.5">
      <span className="shrink-0 [perspective:200px]"><PrismMark size={size} className="logo-prism block" /></span>
      <span translate="no" className="font-display text-xl font-bold tracking-tight">Vid<span className="grad-text">Mind</span></span>
    </Link>
  );
}
