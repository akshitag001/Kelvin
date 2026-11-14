import { useRef } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Summary } from "../lib/api";
import { SERIES } from "../lib/colors";
import { exportPng } from "../lib/export";
import { full, MON, MONTHS, monthRange } from "../lib/format";
import { Card, Stat } from "./ui";

export function Seasons({ s }: { s: Summary }) {
  const ref = useRef<HTMLDivElement>(null);
  const se = s.seasonality;
  const data = se.by_month.map((b, i) => ({
    month: MON[i],
    range: b.min !== undefined ? [b.min, b.max] : null,
    iqr: b.p25 !== undefined ? [b.p25, b.p75] : null,
    median: b.median ?? null,
    current: se.current[i],
    previous: se.previous[i],
  }));
  const season = se.season.months;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Peak month" value={se.peak_month ? MONTHS[se.peak_month - 1] : "–"} sub={`highest median, ${s.baseline.start_year}–${s.baseline.end_year}`} accent />
        <Stat label="Fire season" value={monthRange(season)} sub={`${Math.round(se.season.share * 100)}% of annual activity`} />
        <Stat label={`${se.current_year} so far`} value={full(se.current.reduce<number>((a, v) => a + (v ?? 0), 0))} sub={s.params.unit} />
      </div>
      <Card eyebrow="Seasonality" title="Monthly envelope with the current year" id="seasons"
        actions={<button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => exportPng(ref.current, "kelvin_seasons.png", "Monthly envelope")}>PNG</button>}>
        <div ref={ref} className="h-[340px]" role="img"
          aria-label={`Monthly envelope. Peak month ${se.peak_month ? MONTHS[se.peak_month - 1] : "unknown"}. Fire season ${monthRange(season)}.`}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
              <CartesianGrid stroke="#EEF1F8" vertical={false} />
              {season.length > 0 && season.length < 12 && (season[0] <= season[season.length - 1]
                ? <ReferenceArea x1={MON[season[0] - 1]} x2={MON[season[season.length - 1] - 1]} fill="#FDB022" fillOpacity={0.08} />
                : <>
                  <ReferenceArea x1={MON[season[0] - 1]} x2="Dec" fill="#FDB022" fillOpacity={0.08} />
                  <ReferenceArea x1="Jan" x2={MON[season[season.length - 1] - 1]} fill="#FDB022" fillOpacity={0.08} />
                </>)}
              <XAxis dataKey="month" tick={{ fontSize: 11.5, fill: "#64748B" }} tickLine={false} axisLine={{ stroke: "#E2E7F1" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => full(v)} />
              <Tooltip formatter={(v: number | number[]) => (Array.isArray(v) ? `${full(v[0])} – ${full(v[1])}` : full(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
              <Area dataKey="range" name="Min–max" fill={SERIES.envelope} stroke="none" isAnimationActive={false} />
              <Area dataKey="iqr" name="Middle 50% (P25–P75)" fill={SERIES.iqr} fillOpacity={0.75} stroke="none" isAnimationActive={false} />
              <Line dataKey="median" name="Median" stroke={SERIES.median} strokeDasharray="5 4" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              <Line dataKey="previous" name={String(se.current_year - 1)} stroke={SERIES.previous} strokeWidth={1.4} dot={false} isAnimationActive={false} />
              <Line dataKey="current" name={String(se.current_year)} stroke={SERIES.current} strokeWidth={2.8} dot={{ r: 3, fill: SERIES.current }} isAnimationActive={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[12px] text-ink-4">Shaded band: the fire season, the shortest run of months holding at least 70% of average annual activity. Baseline {s.baseline.start_year}–{s.baseline.end_year}.</p>
      </Card>
    </div>
  );
}
