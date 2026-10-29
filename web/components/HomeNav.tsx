import Link from "next/link";
import Logo from "@/components/Logo";
import ThemeSwitch from "@/components/ThemeSwitch";

const LINKS = [["/about", "How it works"], ["/jobs/sample", "Example"], ["/library", "Library"]] as const;

/** The one navigation bar for home, About and Library: a glass bar that content scrolls under. */
export function HomeNav({ current }: { current?: string }) {
  return (
    <header className="glass sticky top-0 z-40">
      <nav aria-label="Main" className="mx-auto flex h-13 max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <Logo size={24} />
        <div className="flex items-center gap-0.5 text-sm sm:gap-2">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={current === href ? "page" : undefined}
              className={`hit min-h-11 items-center rounded-full px-3 transition-colors hover:text-ink aria-[current=page]:text-ink ${href === "/library" ? "inline-flex" : "hidden sm:inline-flex"} ${current === href ? "" : "text-graphite"}`}>
              {label}
            </Link>
          ))}
          <ThemeSwitch />
        </div>
      </nav>
    </header>
  );
}

export function HomeFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl border-t border-rule px-4 py-6 text-xs text-graphite sm:px-6">
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-2">
        <p>The video, transcript and screen text go to the AI model provider.</p>
        <p>Built for the Meta AI Developer Hackathon, 2026 by Ashutosh Rath</p>
      </div>
    </footer>
  );
}
