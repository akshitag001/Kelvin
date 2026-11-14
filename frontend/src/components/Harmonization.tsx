import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { api, type Diagnostics, type Summary } from "../lib/api";
import { SERIES } from "../lib/colors";
import { exportPng } from "../lib/export";
import { full, MON, pct } from "../lib/format";
import { Card, Notice, Segmented, Spinner, Stat } from "./ui";

const SEASONS = ["Dec–Feb", "Mar–May", "Jun–Aug", "Sep–Nov"];
const LEVEL_LABEL: Record<string, string> = { "block-season": "Block + season", block: "Block (all seasons)", region: "10° region", global: "Global" };

export function Harmonization({ s }: { s: Summary }) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [smooth, setSmooth] = useState<"monthly" | "rolling">("rolling");
  const tsRef = useRef<HTMLDivElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const h = s.harmonization;

  useEffect(() => {
    setDiag(null);
    api.diagnostics(h.cv_region, s.params.metric, s.params.confidence).then(setDiag).catch((e) => setErr(e.message));
  }, [h.cv_region, s.params.metric, s.params.confidence]);

  // native vs harmonized series; the 12-month rolling sum makes the 2012 step easy to see
  const series = useMemo(() => {
    const rows = s.monthly;
    const roll = (key: "modis" | "viirs" | "harmonized" | "lo" | "hi" | "stitch") => rows.map((_, i) => {
      if (smooth === "monthly") return rows[i][key];
      if (i < 11) return null;
      let sum = 0;
      for (let j = i - 11; j <= i; j++) { const v = rows[j][key]; if (v === null) return null; sum += v; }
      return sum;
    });
    const m = roll("modis"), v = roll("viirs"), hz = roll("harmonized"), lo = roll("lo"), hi = roll("hi"), st = roll("stitch");
    return rows.map((r, i) => ({ ym: r.ym, modis: m[i], viirs: v[i], harmonized: hz[i], stitch: st[i], band: lo[i] !== null && hi[i] !== null ? [lo[i], hi[i]] : null }));
  }, [s.monthly, smooth]);

  const viirsStart = s.monthly.find((r) => r.viirs !== null)?.ym;
  const switchYm = h.switch_date.slice(0, 7);
  const cv = h.cv;

  return (
    <div className="space-y-4">
      <Card eyebrow="Why harmonize" title="The same fires, seen by two generations of satellites">
        <div className="grid gap-4 text-[13.5px] leading-relaxed text-ink-3 md:grid-cols-3">
          <p><b className="text-ink-2">The problem.</b> VIIRS (375 m, since 2012) sees many more small fires than MODIS (1 km, since 2000). Stitch the raw counts together and every series jumps when VIIRS takes over, even if nothing changed on the ground.</p>
          <p><b className="text-ink-2">The fix.</b> Count 1 km cell-days instead of pixels, then scale VIIRS by a factor <i>k</i> fitted where both sensors overlap ({h.calibration_window[0].slice(0, 4)}–{h.calibration_window[1].slice(0, 4)}), per 1° block and season.</p>
          <p><b className="text-ink-2">The result.</b> Before {h.switch_date.slice(0, 4)} the series is MODIS; from then on it is <i>k</i>·VIIRS, in MODIS-equivalent units. The two are never added together.</p>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="k for this area" value={h.k ? h.k.toFixed(3) : "–"} sub={h.k ? `90% interval ${h.k_lo?.toFixed(3)}–${h.k_hi?.toFixed(3)}` : "not calibrated"} accent />
        <Stat label="Validation error" value={cv?.wmape != null ? pct(cv.wmape, 1) : "–"} sub={`leave-one-year-out, ${h.cv_region === "all" ? "all data" : "this region"}`} />
        <Stat label="Rank correlation" value={cv?.spearman != null ? cv.spearman.toFixed(3) : "–"} sub="Spearman, monthly series" />
        <Stat label="Bias" value={cv?.bias != null ? `${cv.bias > 0 ? "+" : ""}${pct(cv.bias, 1)}` : "–"} sub={`R² ${cv?.r2 != null ? cv.r2.toFixed(3) : "–"}`} />
      </div>

      <Card eyebrow="Before and after" title="Native series vs harmonized" id="h-ts"
        actions={<>
          <Segmented<"monthly" | "rolling"> size="sm" label="Smoothing" value={smooth} onChange={setSmooth}
            options={[{ value: "rolling", label: "12-month sum" }, { value: "monthly", label: "Monthly" }]} />
          <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => exportPng(tsRef.current, "kelvin_harmonization.png", "Native vs harmonized")}>PNG</button>
        </>}>
        <div ref={tsRef} className="h-[340px]" role="img"
          aria-label="Line chart: MODIS native, VIIRS native and the harmonized series with its 90% uncertainty band. The VIIRS native line sits well above MODIS; the harmonized series follows MODIS before the switch date and scaled VIIRS after it.">
          <ResponsiveContainer>
            <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
              <CartesianGrid stroke="#EEF1F8" vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={{ stroke: "#E2E7F1" }} minTickGap={40} tickFormatter={(v: string) => v.slice(0, 4)} />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={false} width={58} tickFormatter={(v) => full(v)} />
              <Tooltip formatter={(v: number | number[]) => (Array.isArray(v) ? `${full(v[0])} – ${full(v[1])}` : full(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
              {viirsStart && <ReferenceLine x={viirsStart} stroke="#0E9384" strokeDasharray="3 3" label={{ value: "VIIRS starts", fontSize: 10.5, fill: "#0E9384", position: "insideTopLeft" }} />}
              <ReferenceLine x={switchYm} stroke="#0B1222" strokeDasharray="3 3" label={{ value: "switch to k·VIIRS", fontSize: 10.5, fill: "#0B1222", position: "insideTopRight" }} />
              <Area dataKey="band" name="Harmonized 90% band" fill={SERIES.band} fillOpacity={0.35} stroke="none" isAnimationActive={false} />
              <Line dataKey="modis" name="MODIS native" stroke={SERIES.modis} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="viirs" name="VIIRS native (unscaled)" stroke={SERIES.viirs} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="stitch" name="Raw stitch (the artifact)" stroke="#94A3B8" strokeDasharray="2 3" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line dataKey="harmonized" name="Harmonized" stroke={SERIES.harmonized} strokeWidth={2.4} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[12px] text-ink-4">The grey dotted "raw stitch" is what you get by naively switching from MODIS to VIIRS counts. The harmonized red line removes that step.</p>
      </Card>

      {err && <Notice level="error">Diagnostics failed: {err}</Notice>}
      {!diag && !err && <Spinner label="Loading diagnostics" />}
      {diag && (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card eyebrow="Overlap scatter" title="Monthly VIIRS vs MODIS in the calibration window" id="h-sc"
              actions={<button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => exportPng(scRef.current, "kelvin_scatter.png", "Overlap scatter")}>PNG</button>}>
              <div ref={scRef} className="h-[320px]" role="img" aria-label="Scatter plot of monthly MODIS against raw and scaled VIIRS. Scaled points fall on the 1:1 line; raw points lie above it.">
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: -4 }}>
                    <CartesianGrid stroke="#EEF1F8" />
                    <XAxis type="number" dataKey="modis" name="MODIS" tick={{ fontSize: 11, fill: "#64748B" }} tickFormatter={(v) => full(v)}
                      label={{ value: "MODIS (Terra or Aqua), monthly", position: "insideBottom", offset: -10, fontSize: 11, fill: "#64748B" }} />
                    <YAxis type="number" dataKey="y" name="VIIRS" tick={{ fontSize: 11, fill: "#64748B" }} width={58} tickFormatter={(v) => full(v)} />
                    <ZAxis range={[22, 22]} />
                    <Tooltip formatter={(v: number) => full(v)} cursor={{ strokeDasharray: "3 3" }} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} verticalAlign="top" />
                    <ReferenceLine segment={[{ x: 0, y: 0 }, { x: Math.max(1, ...diag.scatter.map((p) => p.modis)), y: Math.max(1, ...diag.scatter.map((p) => p.modis)) }]}
                      stroke="#0B1222" strokeDasharray="4 4" ifOverflow="extendDomain" />
                    <Scatter name="VIIRS raw" data={diag.scatter.map((p) => ({ modis: p.modis, y: p.viirs_raw }))} fill={SERIES.viirs} fillOpacity={0.45} />
                    <Scatter name="VIIRS × k (held-out year)" data={diag.scatter.map((p) => ({ modis: p.modis, y: p.viirs_scaled }))} fill={SERIES.harmonized} fillOpacity={0.7} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-[12px] text-ink-4">Dashed: the 1:1 line. Scaled points use a k fitted without their own year, so this is an honest out-of-sample check.</p>
            </Card>
            <Card eyebrow="Calibration factors" title="k by season, and how it was estimated">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[0, 1, 2, 3].map((si) => {
                  const r = diag.k_by_season.find((x) => x.season === si);
                  return (
                    <div key={si} className="rounded-xl border border-haze-200 bg-white px-3 py-2.5">
                      <div className="eyebrow">{SEASONS[si]}</div>
                      <div className="num mt-1 text-lg font-semibold">{r ? r.k.toFixed(3) : "–"}</div>
                      <div className="text-[11px] text-ink-4">{r ? `${full(r.n)} VIIRS cell-days` : ""}</div>
                    </div>
                  );
                })}
              </div>
              <h4 className="mt-5 text-[13px] font-semibold text-ink-2">Shrinkage level used (share of VIIRS evidence)</h4>
              <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-haze-100" role="img"
                aria-label={Object.entries(diag.level_share).map(([k, v]) => `${LEVEL_LABEL[k] ?? k} ${pct(v)}`).join(", ")}>
                {Object.entries(diag.level_share).map(([k, v], i) => (
                  <span key={k} style={{ width: `${v * 100}%`, background: ["#D92D20", "#F79009", "#5B6CF0", "#94A3B8"][i % 4] }} />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
                {Object.entries(diag.level_share).map(([k, v], i) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: ["#D92D20", "#F79009", "#5B6CF0", "#94A3B8"][i % 4] }} />{LEVEL_LABEL[k] ?? k} {pct(v)}
                  </li>
                ))}
              </ul>
              <h4 className="mt-5 text-[13px] font-semibold text-ink-2">Satellite chain</h4>
              <ul className="mt-1 space-y-1 text-[12.5px] text-ink-3">
                <li>Reference pair: Aqua MODIS and Suomi NPP VIIRS (both cross the equator at about 13:30).</li>
                {Object.entries(diag.chain).map(([sat, c]) => (
                  <li key={sat} className="num">{sat} → {c.to}: × {c.factor.toFixed(3)} ({c.n_months} overlap months)</li>
                ))}
                {diag.terra_global && <li className="num">Terra-only months (before Aug 2002): × {diag.terra_global.toFixed(3)} on average, flagged "estimated"</li>}
              </ul>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <Card eyebrow="Cross-validation" title="Leave-one-year-out, per region">
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="text-ink-4"><tr>{["Region", "Months", "Weighted error", "MAPE", "Bias", "R²", "Spearman"].map((x) => <th key={x} scope="col" className="py-1.5 pr-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody className="num">
                    {diag.cv.map((r) => (
                      <tr key={r.region} className={`border-t border-haze-100 ${r.region === h.cv_region ? "bg-flame-50/60" : ""}`}>
                        <th scope="row" className="py-1.5 pr-3 font-sans font-medium text-ink-2">{r.region === "all" ? "All data" : r.region.replace(/_/g, " ")}</th>
                        <td className="pr-3">{r.n_months}</td><td className="pr-3">{pct(r.wmape, 1)}</td><td className="pr-3">{pct(r.mape, 1)}</td>
                        <td className="pr-3">{r.bias != null ? `${r.bias > 0 ? "+" : ""}${pct(r.bias, 1)}` : "–"}</td>
                        <td className="pr-3">{r.r2?.toFixed(3) ?? "–"}</td><td>{r.spearman?.toFixed(3) ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-ink-4">Each year in the window is held out in turn; k is refitted on the rest and used to predict that year's MODIS from VIIRS. MAPE counts months with at least 20 MODIS units only.</p>
            </Card>
            <Card eyebrow="Terra-only correction" title="Terra → (Terra or Aqua) by calendar month">
              <div className="flex h-[150px] items-end gap-1.5" role="img" aria-label="Bar chart of the Terra-only correction factor by calendar month">
                {diag.terra_factor.map((t) => {
                  const max = Math.max(...diag.terra_factor.map((x) => x.f ?? 0), 1);
                  return (
                    <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
                      <span className="num text-[9.5px] text-ink-4">{t.f?.toFixed(2)}</span>
                      <span className="w-full rounded-t bg-orbit-400/70" style={{ height: `${((t.f ?? 0) / max) * 100}px` }} />
                      <span className="text-[10px] text-ink-4">{MON[t.month - 1][0]}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[12px] text-ink-4">Before Aqua's first full month, only Terra flew. These months are scaled by the factor above (fitted in {s.harmonization.terra_only_until ? "2003–2006" : "the first Aqua years"}) and hatched in the calendar.</p>
            </Card>
          </div>

          <Card eyebrow="Per-block factors" title="Largest 1° blocks in this region">
            <div className="scrollbar-thin max-h-[300px] overflow-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="sticky top-0 bg-white text-ink-4"><tr>{["Block (SW corner)", "Season", "k", "90% interval", "Raw ratio", "VIIRS cell-days", "Level"].map((x) => <th key={x} scope="col" className="py-1.5 pr-3 font-medium">{x}</th>)}</tr></thead>
                <tbody className="num">
                  {diag.k_table.slice(0, 60).map((r) => (
                    <tr key={`${r.block_id}-${r.season}`} className="border-t border-haze-100">
                      <td className="py-1 pr-3">{r.lat}°, {r.lon}°</td><td className="pr-3 font-sans">{SEASONS[r.season]}</td>
                      <td className="pr-3 font-semibold">{r.k.toFixed(3)}</td><td className="pr-3">{r.k_lo.toFixed(2)}–{r.k_hi.toFixed(2)}</td>
                      <td className="pr-3">{r.raw_ratio.toFixed(3)}</td><td className="pr-3">{full(r.n_viirs)}</td><td className="font-sans text-ink-3">{LEVEL_LABEL[r.level] ?? r.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
