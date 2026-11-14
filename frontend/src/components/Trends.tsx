import { useRef } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Summary } from "../lib/api";
import { SERIES } from "../lib/colors";
import { exportPng } from "../lib/export";
import { full, MONTHS, ratio } from "../lib/format";
import { Card, ClassPill, Stat } from "./ui";

export function Trends({ s, onSelect }: { s: Summary; onSelect: (ym: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = s.trend;
  const data = s.annual.map((a) => ({
    ...a,
    fit: t.slope !== null && t.intercept !== null && a.complete ? t.intercept + t.slope * a.year : null,
  }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Trend" value={t.slope_pct !== null ? `${t.slope_pct > 0 ? "+" : ""}${t.slope_pct.toFixed(1)}% / yr` : "–"} sub="Theil–Sen slope, share of median year" accent={t.direction === "up"} />
        <Stat label="Mann–Kendall p" value={t.p !== null ? t.p.toFixed(3) : "–"} sub={t.p !== null && t.p < 0.05 ? "statistically clear" : "not statistically clear"} />
        <Stat label="Complete years" value={t.n} sub="partial years excluded from the trend" />
      </div>
      <Card eyebrow="Annual totals" title="Year by year, with the trend line" id="trend"
        actions={<button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => exportPng(ref.current, "kelvin_annual.png", "Annual totals")}>PNG</button>}>
        <div ref={ref} className="h-[300px]" role="img" aria-label={`Annual totals bar chart. ${t.wording}`}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
              <CartesianGrid stroke="#EEF1F8" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={{ stroke: "#E2E7F1" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={false} width={58} tickFormatter={(v) => full(v)} />
              <Tooltip formatter={(v: number, n: string) => [full(v), n === "fit" ? "Trend" : "Total"]} />
              <Bar dataKey="total" name="Total" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((d) => <Cell key={d.year} fill={SERIES.harmonized} fillOpacity={d.complete ? (d.estimated ? 0.6 : 0.9) : 0.3} />)}
              </Bar>
              <Line dataKey="fit" name="fit" stroke="#0B1222" strokeWidth={1.8} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 rounded-xl bg-haze-50 px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">{t.wording}</p>
        <p className="mt-2 text-[12px] text-ink-4">Faded bars: incomplete years. Lighter bars: years that include estimated Terra-only months.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card eyebrow="Rankings" title="Top 10 months" id="topm">
          <ol className="divide-y divide-haze-100">
            {s.rankings.months.map((m) => (
              <li key={m.ym}>
                <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-haze-50" onClick={() => onSelect(m.ym)}>
                  <span className="num w-6 text-xs text-ink-4">{m.rank}</span>
                  <span className="flex-1 text-sm font-medium text-ink-2">{MONTHS[m.month - 1]} {m.year}</span>
                  <span className="num text-sm text-ink">{full(m.value)}</span>
                  <span className="num w-12 text-right text-xs text-ink-4">{ratio(m.ratio)}</span>
                  <ClassPill cls={m.cls} size="sm" label={m.cls === "record_high" ? "Record" : undefined} />
                </button>
              </li>
            ))}
          </ol>
        </Card>
        <Card eyebrow="Rankings" title="Top 10 years (complete years)" id="topy">
          <ol className="divide-y divide-haze-100">
            {s.rankings.years.map((y) => {
              const max = s.rankings.years[0]?.total || 1;
              return (
                <li key={y.year} className="flex items-center gap-3 px-2 py-2">
                  <span className="num w-6 text-xs text-ink-4">{y.rank}</span>
                  <span className="num w-12 text-sm font-medium text-ink-2">{y.year}</span>
                  <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-haze-100">
                    <span className="flame-bar absolute inset-y-0 left-0 rounded-full" style={{ width: `${(y.total / max) * 100}%` }} />
                  </span>
                  <span className="num w-20 text-right text-sm text-ink">{full(y.total)}</span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
