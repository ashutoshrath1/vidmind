import { formatSeconds, modelName } from "@/lib/api";
import { type View, modelsUsed } from "@/lib/trace";

/** Every model that worked on this video and what it did, one line each, straight from the run log. */
export default function ModelsUsed({ view }: { view: View }) {
  const used = modelsUsed(view.events).filter((m) => m.did.length);
  if (!used.length) return null;
  return (
    <section aria-label="Models in this video" className="rounded-lg bg-sheet p-3 ring-1 ring-rule">
      <ul className="space-y-1.5 text-xs">
        {used.map((m, i) => (
          <li key={m.model} className="arrive flex items-center gap-2" style={{ animationDelay: `${i * 60}ms` }} title={`${m.model}: ${m.did.join(", ")}`}>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-scan" />
            <span className="shrink-0 font-mono font-semibold">{modelName(m.model)}</span>
            <span className="min-w-0 flex-1 truncate text-graphite">{m.did.join(", ")}</span>
            {m.seconds > 0 && <span className="tabular shrink-0 text-graphite">{formatSeconds(m.seconds)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
