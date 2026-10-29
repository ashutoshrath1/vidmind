import { HomeFooter, HomeNav } from "@/components/HomeNav";
import Landing from "@/components/Landing";

export const metadata = { title: "How VidMind works" };

/** The long story, for people who want it: features, a replayed run, the models, measured numbers, questions. */
export default function About() {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <HomeNav current="/about" />
      <main className="page-enter flex-1 overflow-x-clip">
        <Landing />
      </main>
      <HomeFooter />
    </div>
  );
}
