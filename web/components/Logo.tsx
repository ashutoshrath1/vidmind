import Link from "next/link";

/** The mark: a play button cut like a prism, in the one tint. Shared by the header and the share card. */
export function PrismMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--scan, #0071e3)" />
      <path d="M11 8.5 24 16H16z" fill="#fff" />
      <path d="M11 23.5 24 16H16z" fill="#fff" opacity="0.7" />
      <path d="M11 8.5 16 16l-5 7.5z" fill="#fff" opacity="0.88" />
    </svg>
  );
}

export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <Link href="/" aria-label="VidMind home" className="hit inline-flex min-h-11 items-center gap-2">
      <PrismMark size={size} className="block shrink-0" />
      <span translate="no" className="font-display text-lg font-semibold tracking-[-0.02em]">VidMind</span>
    </Link>
  );
}
