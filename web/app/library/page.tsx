import { HomeFooter, HomeNav } from "@/components/HomeNav";
import Library from "@/components/Library";

export const metadata = { title: "Library | VidMind" };

/** Every note this browser made. No account: the list lives in this browser. */
export default function LibraryPage() {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <HomeNav current="/library" />
      <main className="page-enter flex flex-1 flex-col">
        <Library />
      </main>
      <HomeFooter />
    </div>
  );
}
