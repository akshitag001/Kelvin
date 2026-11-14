import { useEffect, useState } from "react";
import { api, type LeaderRow, type Region, type Status } from "../lib/api";
import { CLASS_STYLE } from "../lib/colors";
import { compact, full, MONTHS, monthRange, ordinal, ratio } from "../lib/format";
import type { AppState } from "../lib/state";
import { ClassPill, Skeleton } from "./ui";

const SATS = [
  { name: "Terra", rx: 150, ry: 46, rot: -18, dur: 26, color: "#4352D6", since: "2000" },
  { name: "Aqua", rx: 170, ry: 58, rot: 14, dur: 31, color: "#5B6CF0", since: "2002" },
  { name: "Suomi NPP", rx: 196, ry: 70, rot: -32, dur: 36, color: "#0E9384", since: "2012" },
  { name: "NOAA-20", rx: 218, ry: 82, rot: 28, dur: 42, color: "#15B79E", since: "2018" },
  { name: "NOAA-21", rx: 238, ry: 92, rot: -6, dur: 48, color: "#2ED3B7", since: "2024" },
];
const FIRES = [[-38, 22], [-12, 34], [24, 4], [44, -18], [-52, -10], [8, -40], [30, 30], [-24, -28], [56, 12]];

function Orbits() {
  return (
    <svg viewBox="-260 -170 520 340" className="h-full w-full" role="img"
      aria-label="Illustration: five fire-sensing satellites, Terra, Aqua, Suomi NPP, NOAA-20 and NOAA-21, orbiting Earth">
      <defs>
        <radialGradient id="earth" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".55" stopColor="#DCE3FB" />
          <stop offset="1" stopColor="#A9B6F2" />
        </radialGradient>
        <radialGradient id="glow" r=".5">
          <stop offset=".6" stopColor="#7C8CF8" stopOpacity=".22" />
          <stop offset="1" stopColor="#7C8CF8" stopOpacity="0" />
        </radialGradient>
        <clipPath id="disk"><circle r="82" /></clipPath>
      </defs>
      <circle r="120" fill="url(#glow)" />
      {SATS.map((s) => (
        <g key={s.name} transform={`rotate(${s.rot})`}>
          <ellipse rx={s.rx} ry={s.ry} fill="none" stroke={s.color} strokeOpacity=".28" strokeWidth="1" strokeDasharray="2 4" />
        </g>
      ))}
      <circle r="82" fill="url(#earth)" stroke="#C7D0F5" />
      <g clipPath="url(#disk)" stroke="#8C9BEA" strokeOpacity=".35" fill="none" strokeWidth=".8">
        {[-60, -30, 0, 30, 60].map((y) => <ellipse key={y} cy={y} rx={Math.sqrt(82 * 82 - y * y)} ry={6} />)}
        {[-55, -25, 5, 35, 65].map((x) => <ellipse key={x} cx={x * 0.3} rx={Math.abs(82 - Math.abs(x)) * 0.55 + 8} ry={82} />)}
        {FIRES.map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <circle r="7" fill="#F04438" fillOpacity=".14" stroke="none" className="animate-pulseDot" style={{ animationDelay: `${i * 0.37}s`, transformOrigin: "center", transformBox: "fill-box" }} />
            <circle r="2.2" fill="#D92D20" stroke="#fff" strokeWidth=".8" strokeOpacity="1" />
          </g>
        ))}
      </g>
      {SATS.map((s, i) => (
        <g key={s.name} transform={`rotate(${s.rot})`}>
          <g>
            <circle r="4" fill="#fff" stroke={s.color} strokeWidth="2">
              <animateMotion dur={`${s.dur}s`} repeatCount="indefinite" begin={`-${i * 5}s`}
                path={`M ${s.rx} 0 A ${s.rx} ${s.ry} 0 1 1 ${-s.rx} 0 A ${s.rx} ${s.ry} 0 1 1 ${s.rx} 0`} />
            </circle>
          </g>
        </g>
      ))}
    </svg>
  );
}

function Sparkline({ values, color = "#D92D20" }: { values: (number | null)[]; color?: string }) {
  const v = values.map((x) => x ?? 0);
  const max = Math.max(...v, 1);
  const w = 120, h = 34;
  const pts = v.map((x, i) => `${(i / Math.max(1, v.length - 1)) * w},${h - 2 - (x / max) * (h - 6)}`).join(" ");
  return (
    <svg width={w} height={h} aria-hidden className="overflow-visible">
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={color} fillOpacity=".08" stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function Home({ status, regions, update }: { status: Status | null; regions: Region[]; update: (p: Partial<AppState>) => void }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!status?.ready) return;
    api.leaderboard().then((r) => setRows(r.regions)).catch((e) => setErr(e.message));
  }, [status?.ready]);

  const open = (id: string, name: string) => update({ aoi: { kind: "region", region: id }, name, workspace: true, tab: "calendar", month: undefined });
  const years = status?.data_start ? new Date().getFullYear() - Number(status.data_start.slice(0, 4)) : 25;
  const top = rows?.[0];

  return (
    <main id="main" className="mx-auto max-w-[1280px] px-4 pb-20 lg:px-6">
      {/* ---------------- hero */}
      <section className="relative grid items-center gap-6 pt-8 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
        <div aria-hidden className="starfield pointer-events-none absolute inset-0 -z-10" />
        <div className="animate-rise">
          <div className="eyebrow mb-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-haze-200 bg-white px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-flame-500 animate-pulseDot" /> Live calendar
            </span>
            <span>MODIS · VIIRS · NASA FIRMS</span>
          </div>
          <h1 className="h-display text-[40px] leading-[1.04] sm:text-[56px]">
            Earth's heat,<br /><span className="flame-text">measured from orbit.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-3">
            {years} years of fire, one consistent calendar, and you can hear it. KELVIN stitches the MODIS and VIIRS hotspot records
            into a single harmonized series, so a jump in the data means a change on the ground, not a change of satellite.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button className="btn-primary px-5 py-2.5 text-[15px]" onClick={() => update({ workspace: true })}>Explore the map →</button>
            {top && <button className="btn-ghost px-5 py-2.5 text-[15px]" onClick={() => open(top.id, top.name)}>Most unusual now: {top.name.split(",")[0]}</button>}
          </div>
          <dl className="mt-9 grid max-w-xl grid-cols-3 gap-3">
            {[
              ["Record", `${status?.data_start?.slice(0, 4) ?? "2000"}–now`],
              ["Detections", status?.detections ? compact(status.detections) : "–"],
              ["VIIRS→MODIS k", status?.harmonization?.global_k ? status.harmonization.global_k.toFixed(2) : "–"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-haze-200 bg-white/70 px-3.5 py-3">
                <dt className="eyebrow">{k}</dt>
                <dd className="num mt-1 text-lg font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="relative mx-auto aspect-[1.5] w-full max-w-[600px]">
          <Orbits />
          <ul className="absolute bottom-0 right-0 hidden gap-1.5 sm:flex" aria-label="Satellites in the record">
            {SATS.map((s) => (
              <li key={s.name} className="rounded-full border border-haze-200 bg-white/85 px-2 py-0.5 text-[10.5px] text-ink-3 backdrop-blur">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.name} <span className="text-ink-4">{s.since}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------- leaderboard */}
      <section className="mt-16" aria-labelledby="lb">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow mb-1">Regional anomaly leaderboard</div>
            <h2 id="lb" className="h-display text-[28px]">Which region is most unusual right now?</h2>
            <p className="mt-1 text-sm text-ink-3">This month so far vs the median of the same days in every earlier year. Harmonized hotspot cell-days.</p>
          </div>
          {rows?.[0] && <div className="num text-xs text-ink-4">as of {status?.data_end}</div>}
        </div>
        {err && <p role="alert" className="text-sm text-flame-700">Could not load the leaderboard: {err}</p>}
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {!rows && !err && [0, 1, 2].map((i) => <li key={i}><Skeleton className="h-[168px]" /></li>)}
          {rows?.map((r) => {
            const st = CLASS_STYLE[r.cls];
            return (
              <li key={r.id}>
                <button onClick={() => open(r.id, r.name)}
                  className="group glass relative block h-full w-full overflow-hidden p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-orbit-500"
                  aria-label={`${r.rank}. ${r.name}: ${r.headline}`}>
                  <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: st.ring }} />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="num text-[11px] text-ink-4">#{r.rank}</div>
                      <div className="h-display text-[17px] leading-tight">{r.name}</div>
                    </div>
                    <ClassPill cls={r.cls} size="sm" />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <div className="num text-[30px] font-semibold leading-none text-ink">{ratio(r.ratio)}</div>
                      <div className="mt-1 text-xs text-ink-4">median · {ordinal(r.percentile)} percentile</div>
                    </div>
                    <Sparkline values={r.spark} color={st.ring === "#CBD3E3" ? "#64748B" : st.ring} />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-haze-200 pt-3 text-xs text-ink-3">
                    <span>{full(r.value)} so far{r.provisional ? " · provisional" : ""}</span>
                    <span>Season {monthRange(r.season)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ---------------- stories */}
      <section className="mt-14" aria-labelledby="stories">
        <div className="eyebrow mb-1">Story presets</div>
        <h2 id="stories" className="h-display mb-5 text-[28px]">Start with a fire season</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {regions.filter((r) => r.story).map((r) => (
            <button key={r.id} disabled={!r.loaded} onClick={() => open(r.id, r.name)}
              className="glass group p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-50">
              <div className="flame-bar mb-4 h-1 w-10 rounded-full" />
              <div className="h-display text-[16px]">{r.story}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{r.blurb}</p>
              <div className="mt-4 text-xs font-medium text-flame-600 group-hover:underline">{r.loaded ? "Open calendar →" : "Not loaded yet"}</div>
            </button>
          ))}
        </div>
      </section>

      {/* ---------------- how it works */}
      <section className="mt-14 grid gap-3 lg:grid-cols-3" aria-label="How harmonization works">
        {[
          ["01", "One common unit", "Every detection is snapped to a 1 km equal-area cell and counted once per day: a hotspot cell-day. That removes most of the 1 km vs 375 m pixel difference and the different number of overpasses."],
          ["02", "Calibrate in the overlap", "From 2012 to 2021 both sensors flew. KELVIN fits a VIIRS-to-MODIS factor k per 1° block and season, shrinking thin samples toward regional and global values, with a bootstrap 90% interval."],
          ["03", "Validate, then trust", "Leave-one-year-out validation predicts each year's MODIS series from VIIRS alone. Error, bias and rank correlation are shown for every region, alongside the native series so you can see the jump that was removed."],
        ].map(([n, t, d]) => (
          <div key={n} className="card">
            <div className="num text-xs text-orbit-500">{n}</div>
            <h3 className="h-display mt-2 text-[17px]">{t}</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">{d}</p>
          </div>
        ))}
      </section>
      <p className="mt-6 text-center text-xs text-ink-4">
        Peak months by region: {rows?.filter((r) => r.peak_month).map((r) => `${r.name.split(",")[0]} ${MONTHS[(r.peak_month ?? 1) - 1]}`).join(" · ")}
      </p>
    </main>
  );
}
