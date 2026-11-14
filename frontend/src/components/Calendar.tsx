import { useMemo, useRef, useState } from "react";
import type { MonthRow, Summary } from "../lib/api";
import { audio, pitchFor } from "../lib/audio";
import { anomalyScale, CLASS_STYLE, countScale, textOn, type Ramp } from "../lib/colors";
import { compact, full, MON, MONTHS, ordinal, ratio } from "../lib/format";
import { Card, Segmented, Toggle, useAnnounce } from "./ui";

export function cellLabel(r: MonthRow, unit: string): string {
  if (r.value === null) return `${MONTHS[r.month - 1]} ${r.year}: no data for this view`;
  let s = `${MONTHS[r.month - 1]} ${r.year}: ${full(r.value)} ${unit}`;
  if (r.ratio !== null) s += `, ${ratio(r.ratio).replace("×", " times")} the median`;
  if (r.cls && r.cls !== "no_baseline") s += `, ${CLASS_STYLE[r.cls].label.toLowerCase()}`;
  if (r.percentile !== null) s += `, ${ordinal(r.percentile)} percentile`;
  if (r.flags.length) s += `. ${r.flags.map((f) => ({ estimated: "Estimated (Terra only)", provisional: "Provisional", partial: "Month in progress" }[f] ?? f)).join(", ")}`;
  return s;
}

interface Props {
  s: Summary;
  selected?: string;
  onSelect: (ym: string) => void;
}

export function Calendar({ s, selected, onSelect }: Props) {
  const [mode, setMode] = useState<"count" | "anomaly">("count");
  const [log, setLog] = useState(false);
  const [ramp, setRamp] = useState<Ramp>("ylorrd");
  const [table, setTable] = useState(false);
  const [sound, setSound] = useState(false);
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const announce = useAnnounce();
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const unit = s.params.unit;

  const { years, grid, max, totals } = useMemo(() => {
    const years = s.years;
    const by = new Map(s.monthly.map((r) => [r.ym, r]));
    const grid = years.map((y) => Array.from({ length: 12 }, (_, m) => by.get(`${y}-${String(m + 1).padStart(2, "0")}`) ?? null));
    const vals = s.monthly.map((r) => r.value ?? 0);
    const totals = years.map((_, i) => {
      const row = grid[i].filter((r): r is MonthRow => !!r && r.value !== null);
      return { total: row.reduce((a, r) => a + (r.value ?? 0), 0), n: row.length };
    });
    return { years, grid, max: Math.max(1, ...vals), totals };
  }, [s]);

  const color = useMemo(() => countScale(max, log, ramp), [max, log, ramp]);
  const anom = useMemo(() => anomalyScale(2), []);
  const totalMax = Math.max(1, ...totals.map((t) => t.total));
  const totalColor = useMemo(() => countScale(totalMax, log, ramp), [totalMax, log, ramp]);

  function move(r: number, c: number) {
    const rr = Math.max(0, Math.min(years.length - 1, r));
    const cc = Math.max(0, Math.min(11, c));
    setFocus([rr, cc]);
    const cell = grid[rr][cc];
    const key = `${years[rr]}-${cc}`;
    refs.current.get(key)?.focus();
    if (cell && sound) {
      audio.tone({ freq: pitchFor(cell.value ?? 0, max), dur: 0.35, gain: 0.55, bright: cell.ratio ? Math.min(1, cell.ratio / 3) : 0.4 });
      announce(cellLabel(cell, unit));
    }
  }

  function onKey(e: React.KeyboardEvent, r: number, c: number) {
    const map: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1],
      Home: [r, 0], End: [r, 11], PageUp: [r - 5, c], PageDown: [r + 5, c],
    };
    if (e.ctrlKey && e.key === "Home") { e.preventDefault(); return move(0, 0); }
    if (e.ctrlKey && e.key === "End") { e.preventDefault(); return move(years.length - 1, 11); }
    if (map[e.key]) { e.preventDefault(); move(...map[e.key]); }
  }

  const legend = mode === "count" ? (
    <div className="flex items-center gap-2 text-[11px] text-ink-4">
      <span>0</span>
      <span className="h-2.5 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => color(log ? Math.expm1(t * Math.log1p(max)) : t * max)).join(",")})` }} />
      <span className="num">{compact(max)}</span>
      <span>{log ? "(log)" : ""}</span>
    </div>
  ) : (
    <div className="flex items-center gap-2 text-[11px] text-ink-4">
      <span>¼× median</span>
      <span className="h-2.5 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${[0.25, 0.5, 1, 2, 4].map((r) => anom(r)).join(",")})` }} />
      <span>4×</span>
    </div>
  );

  return (
    <Card eyebrow={`${s.params.unit_long}`} title="Burning activity calendar" id="cal-title"
      actions={<>
        <Segmented<"count" | "anomaly"> size="sm" label="Calendar coloring" value={mode} onChange={setMode}
          options={[{ value: "count", label: "Counts" }, { value: "anomaly", label: "Anomaly vs median" }]} />
        {mode === "count" && <Toggle label="Log scale" checked={log} onChange={setLog} />}
        {mode === "count" && (
          <Segmented<Ramp> size="sm" label="Color ramp" value={ramp} onChange={setRamp}
            options={[{ value: "ylorrd", label: "YlOrRd" }, { value: "cividis", label: "Cividis" }]} />
        )}
        <Toggle label="Tones on arrow keys" checked={sound} onChange={setSound} hint="Plays a short tone for each cell as you move with the arrow keys" />
        <Toggle label="Table view" checked={table} onChange={setTable} />
      </>}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {legend}
        <ul className="flex flex-wrap gap-3 text-[11px] text-ink-3" aria-label="Cell markers">
          <li className="flex items-center gap-1.5"><span className="cell-estimated relative inline-block h-3.5 w-5 rounded bg-haze-100" />Estimated (Terra only)</li>
          <li className="flex items-center gap-1.5"><span className="cell-provisional relative inline-block h-3.5 w-5 rounded bg-haze-100" />Provisional (NRT)</li>
          <li className="flex items-center gap-1.5"><span className="cell-partial relative inline-block h-3.5 w-5 rounded bg-haze-100" />Month in progress</li>
        </ul>
      </div>

      {table ? <CalendarTable s={s} /> : (
        <div className="scrollbar-thin -mx-1 overflow-x-auto px-1 pb-1">
          <div role="grid" aria-labelledby="cal-title" aria-rowcount={years.length + 1} aria-colcount={14}
            className="min-w-[700px] text-[11px]">
            <div role="row" className="grid grid-cols-[44px_repeat(12,minmax(0,1fr))_64px] gap-[3px] pb-1">
              <span role="columnheader" className="sr-only">Year</span>
              {MON.map((m) => <span key={m} role="columnheader" className="text-center font-medium text-ink-4">{m}</span>)}
              <span role="columnheader" className="text-center font-medium text-ink-4">Year</span>
            </div>
            {years.map((y, ri) => (
              <div role="row" key={y} className="grid grid-cols-[44px_repeat(12,minmax(0,1fr))_64px] gap-[3px] pb-[3px]">
                <span role="rowheader" className="num flex items-center text-ink-3">{y}</span>
                {grid[ri].map((cell, ci) => {
                  if (!cell) return <span key={ci} role="gridcell" aria-label={`${MONTHS[ci]} ${y}: outside the selected dates`} className="h-[30px] rounded-[5px] bg-transparent" />;
                  const has = cell.value !== null;
                  const bg = !has ? "#F1F3F8" : mode === "count" ? color(cell.value!) : anom(cell.ratio);
                  const fg = has ? textOn(bg) : "#94A3B8";
                  const isSel = selected === cell.ym;
                  const isFocus = focus[0] === ri && focus[1] === ci;
                  const cls = ["relative h-[30px] rounded-[5px] num text-[10.5px] font-medium transition-[transform,box-shadow] hover:z-10 hover:scale-[1.12] hover:shadow-md focus-visible:z-10",
                    cell.flags.includes("estimated") ? "cell-estimated" : "",
                    cell.flags.includes("provisional") ? "cell-provisional" : "",
                    cell.flags.includes("partial") ? "cell-partial" : "",
                    isSel ? "ring-2 ring-ink ring-offset-1 z-10" : ""].join(" ");
                  return (
                    <button key={ci} role="gridcell" ref={(el) => { if (el) refs.current.set(`${y}-${ci}`, el); }}
                      tabIndex={isFocus ? 0 : -1} aria-selected={isSel} aria-label={cellLabel(cell, unit)} title={cellLabel(cell, unit)}
                      className={cls} style={{ background: bg, color: fg }}
                      onFocus={() => setFocus([ri, ci])} onKeyDown={(e) => onKey(e, ri, ci)}
                      onClick={() => has && onSelect(cell.ym)}>
                      {has ? (mode === "anomaly" && cell.ratio !== null ? ratio(cell.ratio) : compact(cell.value)) : "–"}
                    </button>
                  );
                })}
                <span role="gridcell" aria-label={`${y} total: ${full(totals[ri].total)} ${unit} over ${totals[ri].n} months`}
                  className="num flex h-[30px] items-center justify-center rounded-[5px] text-[10.5px] font-semibold"
                  style={{ background: totals[ri].n ? totalColor(totals[ri].total) : "#F1F3F8", color: totals[ri].n ? textOn(totalColor(totals[ri].total)) : "#94A3B8", opacity: totals[ri].n < 12 ? 0.75 : 1 }}>
                  {totals[ri].n ? compact(totals[ri].total) : "–"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[12px] text-ink-4">
        Click a cell (or press Enter) to open its daily view and show its hotspots on the map. Arrow keys move between cells; Home/End jump within a year.
        Anomalies compare each month with the same calendar month in {s.baseline.start_year}–{s.baseline.end_year}.
      </p>
    </Card>
  );
}

function CalendarTable({ s }: { s: Summary }) {
  return (
    <div className="scrollbar-thin max-h-[560px] overflow-auto rounded-xl border border-haze-200">
      <table className="w-full text-left text-[12.5px]">
        <caption className="sr-only">Monthly values, anomaly and flags</caption>
        <thead className="sticky top-0 bg-haze-50 text-ink-3">
          <tr>{["Month", s.params.unit, "Median", "Ratio", "Percentile", "Class", "Source", "Flags"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="num">
          {[...s.monthly].reverse().map((r) => (
            <tr key={r.ym} className="border-t border-haze-100">
              <th scope="row" className="px-3 py-1.5 font-medium text-ink-2">{r.ym}</th>
              <td className="px-3 py-1.5">{full(r.value)}</td>
              <td className="px-3 py-1.5">{full(r.median)}</td>
              <td className="px-3 py-1.5">{ratio(r.ratio)}</td>
              <td className="px-3 py-1.5">{ordinal(r.percentile)}</td>
              <td className="px-3 py-1.5 font-sans">{r.cls ? CLASS_STYLE[r.cls].label : "–"}</td>
              <td className="px-3 py-1.5 font-sans">{r.source}</td>
              <td className="px-3 py-1.5 font-sans text-ink-4">{r.flags.join(", ") || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
