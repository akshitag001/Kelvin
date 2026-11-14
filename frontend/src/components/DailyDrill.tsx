import { useEffect, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Daily, type Query } from "../lib/api";
import { audio, type PlayHandle } from "../lib/audio";
import { SERIES } from "../lib/colors";
import { full, ordinal, ratio, ymLabel } from "../lib/format";
import { Card, ClassPill, Segmented, Spinner } from "./ui";

export function DailyDrill({ query, ym, onClose }: { query: Query; ym: string; onClose: () => void }) {
  const [d, setD] = useState<Daily | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"daily" | "cumulative">("daily");
  const [playing, setPlaying] = useState<number | null>(null);
  const handle = useRef<PlayHandle | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = new AbortController();
    setD(null); setErr(null);
    api.daily(query, ym, c.signal).then(setD).catch((e) => e.name !== "AbortError" && setErr(e.message));
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return () => { c.abort(); handle.current?.stop(); };
  }, [query, ym]);

  async function crackle() {
    if (!d) return;
    handle.current?.stop();
    const max = Math.max(1, ...d.days.map((x) => x.value ?? 0));
    for (const day of d.days) {
      if (day.value === null) continue;
      setPlaying(day.day);
      handle.current = audio.crackle(2 + (day.value / max) * 60, 0.55);
      await handle.current.done;
      if (handle.current === null) break;
    }
    setPlaying(null);
  }
  function stop() { const h = handle.current; handle.current = null; h?.stop(); setPlaying(null); }

  const data = d?.days.map((x) => ({
    ...x, band: x.p25 !== null && x.p75 !== null ? [x.p25, x.p75] : null, range: x.min !== null && x.max !== null ? [x.min, x.max] : null,
    cband: x.cum_p25 !== null && x.cum_p75 !== null ? [x.cum_p25, x.cum_p75] : null,
  }));

  return (
    <div ref={ref}>
      <Card eyebrow="Daily drill-down" title={ymLabel(ym)} id="daily-title"
        actions={<>
          <Segmented<"daily" | "cumulative"> size="sm" label="Daily chart mode" value={mode} onChange={setMode}
            options={[{ value: "daily", label: "Per day" }, { value: "cumulative", label: "Month to date" }]} />
          {playing ? <button className="btn-ghost px-2.5 py-1 text-xs" onClick={stop}>■ Stop crackle</button>
            : <button className="btn-ghost px-2.5 py-1 text-xs" onClick={crackle} disabled={!d} title="Crackle mode: click rate follows each day's hotspot count">♪ Crackle</button>}
          <button className="btn-quiet px-2.5 py-1 text-xs" onClick={onClose} aria-label="Close daily view">✕</button>
        </>}>
        {err && <p role="alert" className="text-sm text-flame-700">{err}</p>}
        {!d && !err && <Spinner label="Loading days" />}
        {d && (
          <>
            {d.to_date && (
              <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
                <ClassPill cls={d.to_date.cls} />
                <span>
                  {d.to_date.full_month ? "Whole month" : `Days 1–${d.to_date.days}`}: <b className="num">{full(d.to_date.value)}</b> {d.unit},{" "}
                  {ratio(d.to_date.ratio)} the median of the same days in {d.baseline.start_year}–{d.baseline.end_year} ({ordinal(d.to_date.percentile)} percentile).
                </span>
              </div>
            )}
            <div className="h-[240px]" aria-hidden>
              <ResponsiveContainer>
                <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="#EEF1F8" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={{ stroke: "#E2E7F1" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip formatter={(v: number | number[]) => (Array.isArray(v) ? `${full(v[0])}–${full(v[1])}` : full(v, 1))} labelFormatter={(l) => `Day ${l}`} />
                  {mode === "daily" ? (<>
                    <Area dataKey="range" name="Historical min–max" fill={SERIES.envelope} stroke="none" isAnimationActive={false} />
                    <Area dataKey="band" name="Historical P25–P75" fill={SERIES.iqr} fillOpacity={0.7} stroke="none" isAnimationActive={false} />
                    <Line dataKey="median" name="Historical median" stroke={SERIES.median} strokeDasharray="4 3" dot={false} strokeWidth={1.4} isAnimationActive={false} />
                    <Bar dataKey="value" name={`${ym}`} fill={SERIES.harmonized} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false}
                      shape={(p: unknown) => {
                        const { x, y, width, height, payload } = p as { x: number; y: number; width: number; height: number; payload: { day: number; provisional: boolean } };
                        return <rect x={x} y={y} width={width} height={Math.max(0, height)} rx={3}
                          fill={payload.day === playing ? "#0B1222" : SERIES.harmonized} fillOpacity={payload.provisional ? 0.5 : 1} />;
                      }} />
                  </>) : (<>
                    <Area dataKey="cband" name="Historical P25–P75 (to date)" fill={SERIES.iqr} fillOpacity={0.7} stroke="none" isAnimationActive={false} />
                    <Line dataKey="cum_median" name="Historical median (to date)" stroke={SERIES.median} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                    <Line dataKey="cumulative" name={`${ym} to date`} stroke={SERIES.harmonized} strokeWidth={2.4} dot={false} isAnimationActive={false} />
                  </>)}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-3 text-[12.5px]">
              <summary className="cursor-pointer text-ink-3">Daily values as a table</summary>
              <table className="mt-2 w-full text-left num">
                <thead className="text-ink-4"><tr><th className="py-1">Day</th><th>Value</th><th>Median</th><th>To date</th><th>Median to date</th></tr></thead>
                <tbody>{d.days.map((x) => (
                  <tr key={x.day} className="border-t border-haze-100">
                    <td className="py-1">{x.date}{x.provisional ? " *" : ""}</td><td>{full(x.value, 1)}</td><td>{full(x.median, 1)}</td><td>{full(x.cumulative, 1)}</td><td>{full(x.cum_median, 1)}</td>
                  </tr>))}</tbody>
              </table>
              <p className="mt-1 text-ink-4">* provisional (near-real-time)</p>
            </details>
            <p className="mt-2 text-[12px] text-ink-4">Crackle mode: a campfire crackle plays for each day, with the click rate proportional to that day's hotspots. The highlighted bar shows the day being played.</p>
          </>
        )}
      </Card>
    </div>
  );
}
