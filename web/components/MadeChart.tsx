import { formatSeconds } from "@/lib/api";
import { rowsOf } from "@/components/MadeRows";
import type { View } from "@/lib/trace";

const tick = (max: number) => {
  const step = [5, 10, 15, 20, 30, 60].find((s) => max / s <= 6) ?? 120;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
};

export default function MadeChart({ view, lead = 0 }: { view: View; lead?: number }) {
  const rows = rowsOf(view);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.end)) * 1.04;
  const pct = (t: number) => `${(100 * t) / max}%`;
  return (
    <figure aria-label="When each step ran" className="text-[15px]">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-graphite">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-5 rounded-full bg-scan" />Meta model</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-5 rounded-full bg-graphite/40" />open-source tool</span>
        <span className="ml-auto tabular">seconds from the link check{lead ? ` (+${formatSeconds(lead)} before the clock starts)` : ""}</span>
      </figcaption>
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-0 sm:left-[13rem]">
          {tick(max).map((t) => (
            <div key={t} className="absolute inset-y-0 border-l border-rule" style={{ left: pct(t) }}>
              <span className="tabular absolute -top-5 -translate-x-1/2 text-[11px] text-graphite">{t}s</span>
            </div>
          ))}
        </div>
        <ol className="relative mt-6 divide-y divide-rule">
          {rows.map((r) => (
            <li key={r.id} className="grid items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[13rem_minmax(0,1fr)]">
              <span className="font-medium">{r.label}</span>
              <div className="relative h-7">
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={`${r.label}: ${r.tool}, from ${formatSeconds(r.start)} to ${formatSeconds(r.end)}`}
                  className={`absolute top-0 h-7 min-w-2 rounded-full ${r.meta ? "bg-scan" : "bg-graphite/40"} outline-offset-2 focus-visible:outline-2 focus-visible:outline-scan`}
                  style={{ left: pct(r.start), width: `calc(${pct(r.end - r.start)})` }}
                />
                <span
                  className="tabular absolute top-0 flex h-7 items-center gap-1.5 text-[13px] leading-none whitespace-nowrap text-graphite"
                  style={r.end / max > 0.6 ? { right: `calc(${100 - 100 * (r.start / max)}% + 8px)` } : { left: `calc(${pct(r.end)} + 8px)` }}
                >
                  <b className="font-semibold text-ink">{formatSeconds(r.end - r.start)}</b> {r.tool}
                  {r.count ? <span className="hidden md:inline"> · {r.count}</span> : null}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
