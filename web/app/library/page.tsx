import Link from "next/link";
import Library from "@/components/Library";
import Logo from "@/components/Logo";
import ThemeSwitch from "@/components/ThemeSwitch";

export const metadata = { title: "Library | VidMind" };

/** Every note this browser made, and one question asked across them. No account: the list lives in this browser. */
export default function LibraryPage() {
  return (
    <main className="page-enter flex min-h-dvh w-full flex-col">
      <header className="sticky top-0 z-40 border-b border-rule/60 bg-lightbox/60 backdrop-blur-xl">
        <nav aria-label="Main" className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <Logo />
          <div className="flex items-center gap-3">
            <ThemeSwitch />
            <Link href="/" className="inline-flex min-h-11 items-center rounded-full bg-scan px-5 font-display font-semibold text-on-scan transition hover:brightness-110">Make notes</Link>
          </div>
        </nav>
      </header>
      <Library />
      <footer className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-rule px-4 py-6 text-xs text-graphite sm:px-8">
        <p>The video, transcript and screen text go to the AI model provider.</p>
        <p>Built for the Meta AI Developer Hackathon, 2026 by Ashutosh Rath</p>
      </footer>
    </main>
  );
}
