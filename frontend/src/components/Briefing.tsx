import { useEffect, useState } from "react";
import { api, type Query, type Summary } from "../lib/api";
import { CLASS_STYLE } from "../lib/colors";
import { full, MON, ordinal, ratio } from "../lib/format";
import { Card, Notice, Spinner } from "./ui";

export function Briefing({ q, s, name }: { q: Query; s: Summary; name: string }) {
  const [b, setB] = useState<{ title: string; paragraphs: string[]; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const c = new AbortController();
    setB(null);
    api.briefing({ ...q, name }, c.signal).then(setB).catch((e) => e.name !== "AbortError" && setErr(e.message));
    return () => c.abort();
  }, [q, name]);

  async function dl(kind: "hotspots" | "calendar") {
    setBusy(kind);
    try {
      await api.download(kind === "hotspots" ? "/api/aoi/hotspots.csv" : "/api/aoi/calendar.csv", q, `kelvin_${kind}_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card eyebrow="Plain-language briefing" title={b?.title ?? "Briefing"}
        actions={<>
          <button className="btn-ghost px-2.5 py-1 text-xs" disabled={!b} onClick={async () => { await navigator.clipboard.writeText(b!.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? "✓ Copied" : "Copy text"}
          </button>
          <button className="btn-primary px-3 py-1 text-xs" onClick={() => window.print()}>Print one-page report</button>
        </>}>
        {err && <Notice level="error">{err}</Notice>}
        {!b && !err && <Spinner label="Writing briefing" />}
        {b && (
          <div className="space-y-3 text-[14.5px] leading-relaxed text-ink-2">
            {b.paragraphs.map((p) => {
              const [head, ...rest] = p.split(". ");
              return <p key={p}><span className="eyebrow mr-2 text-flame-700">{head}</span>{rest.join(". ")}</p>;
            })}
          </div>
        )}
        <p className="mt-4 text-[11.5px] text-ink-4">Generated from fixed templates, with no language model: the same inputs always give the same text.</p>
      </Card>

      <Card eyebrow="Downloads" title="Take the data with you">
        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => dl("hotspots")} disabled={!!busy} className="rounded-xl border border-haze-200 bg-white p-4 text-left transition hover:border-flame-500/40 hover:shadow-sm disabled:opacity-60">
            <div className="h-display text-[15px]">{busy === "hotspots" ? "Preparing…" : "Hotspots CSV"}</div>
            <p className="mt-1 text-[12.5px] text-ink-3">Every detection in this area and date range: sensor, satellite, SP/NRT product, provisional flag, confidence, FRP and 1 km cell id. The header records the query, source and attribution.</p>
          </button>
          <button onClick={() => dl("calendar")} disabled={!!busy} className="rounded-xl border border-haze-200 bg-white p-4 text-left transition hover:border-flame-500/40 hover:shadow-sm disabled:opacity-60">
            <div className="h-display text-[15px]">{busy === "calendar" ? "Preparing…" : "Monthly calendar CSV"}</div>
            <p className="mt-1 text-[12.5px] text-ink-3">The harmonized monthly series with its 90% band, MODIS and VIIRS native series, baseline median, ratio, percentile, anomaly class and flags.</p>
          </button>
        </div>
        <p className="mt-3 text-[12px] text-ink-4">Chart images: use the PNG button on any chart. Data: NASA FIRMS (LANCE/EOSDIS). NASA does not endorse this project.</p>
      </Card>

      <PrintReport s={s} name={name} paragraphs={b?.paragraphs ?? []} />
    </div>
  );
}

function PrintReport({ s, name, paragraphs }: { s: Summary; name: string; paragraphs: string[] }) {
  const recent = s.monthly.slice(-24);
  const max = Math.max(1, ...recent.map((r) => r.value ?? 0));
  return (
    <div className="print-only text-[11px] text-black">
      <div className="mb-3 flex items-end justify-between border-b border-black pb-2">
        <div>
          <div className="text-[20px] font-bold tracking-[0.12em]">KELVIN</div>
          <div>Harmonized burning activity report · {name}</div>
        </div>
        <div className="text-right">Data through {s.data.end}<br />Generated {new Date().toISOString().slice(0, 10)}</div>
      </div>
      {s.data.demo && <div className="mb-2 border border-black p-1 text-center font-bold">SYNTHETIC DEMO DATA. NOT REAL FIRE DETECTIONS.</div>}
      {s.current && (
        <div className="mb-3 rounded border border-gray-400 p-2">
          <b>{s.current.headline}</b> Class: {CLASS_STYLE[s.current.cls].label}. Median {full(s.current.median)}, value {full(s.current.value)} {s.params.unit}.
        </div>
      )}
      <div className="mb-1 font-semibold">Last 24 months ({s.params.unit})</div>
      <div className="mb-3 flex h-[90px] items-end gap-[2px] border-b border-gray-400">
        {recent.map((r) => (
          <div key={r.ym} className="flex flex-1 flex-col items-center">
            <div style={{ height: `${((r.value ?? 0) / max) * 80}px`, background: "#B42318", width: "100%" }} />
          </div>
        ))}
      </div>
      <div className="mb-3 flex justify-between text-[9px]">{recent.filter((_, i) => i % 3 === 0).map((r) => <span key={r.ym}>{MON[r.month - 1]} {String(r.year).slice(2)}</span>)}</div>
      <table className="mb-3 w-full border-collapse text-[10px]">
        <thead><tr className="border-b border-gray-400 text-left"><th>Top months</th><th>Value</th><th>× median</th><th>Top years</th><th>Total</th></tr></thead>
        <tbody>
          {s.rankings.months.slice(0, 5).map((m, i) => (
            <tr key={m.ym}><td>{m.ym}</td><td>{full(m.value)}</td><td>{ratio(m.ratio)}</td><td>{s.rankings.years[i]?.year ?? ""}</td><td>{s.rankings.years[i] ? full(s.rankings.years[i].total) : ""}</td></tr>
          ))}
        </tbody>
      </table>
      {paragraphs.map((p) => <p key={p} className="mb-1.5">{p}</p>)}
      <p className="mt-2">Harmonization: k = {s.harmonization.k?.toFixed(3) ?? "n/a"}, validation error {s.harmonization.cv?.wmape != null ? `${(s.harmonization.cv.wmape * 100).toFixed(1)}%` : "n/a"}; current-month percentile {ordinal(s.current?.percentile)}.</p>
      <p className="mt-3 border-t border-gray-400 pt-1 text-[9px]">Data: NASA FIRMS (LANCE/EOSDIS), MODIS and VIIRS active fire detections. NASA does not endorse this project. Hotspots are detections of heat, not confirmed fires, burned area or cause.</p>
    </div>
  );
}
