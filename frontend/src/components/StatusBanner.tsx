import type { Summary } from "../lib/api";
import { CLASS_STYLE } from "../lib/colors";
import { full, ordinal, pct, ratio } from "../lib/format";
import { ClassPill, Notice } from "./ui";

export function StatusBanner({ s, name }: { s: Summary; name: string }) {
  const c = s.current;
  const st = CLASS_STYLE[c?.cls ?? "no_baseline"];
  const h = s.harmonization;
  return (
    <section aria-labelledby="standing" className="glass relative overflow-hidden p-5 sm:p-6">
      <div aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: st.ring }} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="eyebrow mb-1.5">Current standing · {name}</div>
          {c ? (
            <>
              <h2 id="standing" className="h-display text-[22px] leading-snug sm:text-[26px]">{c.headline}</h2>
              <p className="mt-2 text-[13px] text-ink-3">
                {full(c.value)} {s.params.unit} vs a median of {full(c.median)} for the same {c.days} days in {c.baseline_years[0]}–{c.baseline_years[1]}
                {c.provisional && <> · <span className="font-medium text-amber-700">includes provisional near-real-time days</span></>}
              </p>
            </>
          ) : (
            <h2 id="standing" className="h-display text-[22px]">No current standing for this area</h2>
          )}
        </div>
        {c && (
          <div className="flex items-center gap-4">
            <Gauge value={c.percentile} color={st.ring} />
            <div className="space-y-2 text-right">
              <ClassPill cls={c.cls} />
              <div className="num text-2xl font-semibold text-ink">{ratio(c.ratio)}</div>
              <div className="text-[11px] text-ink-4">of median</div>
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[11.5px]">
        {c?.off_season && <Chip title="The usual count for these days is tiny, so ratios swing widely">off-season · small counts</Chip>}
        <Chip>{full(s.aoi.area_km2)} km² · {full(s.aoi.cells)} active cells</Chip>
        {h.k && <Chip title="VIIRS-to-MODIS scale factor used for this area (90% interval)">k = {h.k.toFixed(2)} [{h.k_lo?.toFixed(2)}–{h.k_hi?.toFixed(2)}]</Chip>}
        {h.cv?.wmape != null && <Chip title="Leave-one-year-out validation error for this region">validation error {pct(h.cv.wmape)}</Chip>}
        <Chip>{s.params.view === "harmonized" ? "Harmonized" : s.params.view === "modis" ? "MODIS native" : "VIIRS native (unscaled)"} · {s.params.unit}</Chip>
        {s.peak && <Chip>record month {s.peak.ym}</Chip>}
      </div>
      {s.warnings.filter((w) => w.code !== "demo").length > 0 && (
        <div className="mt-4 space-y-2">
          {s.warnings.filter((w) => w.code !== "demo").map((w) => <Notice key={w.code} level={w.level}>{w.text}</Notice>)}
        </div>
      )}
    </section>
  );
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span title={title} className="num rounded-full border border-haze-200 bg-white/80 px-2.5 py-1 text-ink-3">{children}</span>;
}

function Gauge({ value, color }: { value: number | null; color: string }) {
  const v = value ?? 0;
  const r = 30, c = Math.PI * r;
  return (
    <figure className="relative" aria-label={`Percentile ${ordinal(value)}`}>
      <svg width="84" height="52" viewBox="0 0 84 52" aria-hidden>
        <path d="M 12 46 A 30 30 0 0 1 72 46" fill="none" stroke="#E2E7F1" strokeWidth="8" strokeLinecap="round" />
        <path d="M 12 46 A 30 30 0 0 1 72 46" fill="none" stroke={color === "#CBD3E3" ? "#94A3B8" : color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <figcaption className="num absolute inset-x-0 bottom-0 text-center text-[13px] font-semibold text-ink">{ordinal(value)}</figcaption>
    </figure>
  );
}
