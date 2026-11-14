import { useEffect, useRef, useState } from "react";
import type { Confidence, Metric, Region, Status, View } from "../lib/api";
import { geocode, placeBbox, placeName, type Place } from "../lib/geo";
import type { AppState } from "../lib/state";
import { Logo } from "./Logo";
import { Segmented } from "./ui";

interface Props {
  state: AppState;
  status: Status | null;
  regions: Region[];
  update: (p: Partial<AppState>) => void;
  onHome: () => void;
  onMethod: () => void;
  onLimits: () => void;
  onPalette: () => void;
}

export function Header({ state, status, regions, update, onHome, onMethod, onLimits, onPalette }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Nominatim: one request per submit (usage policy), never per keystroke.
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setResults(await geocode(q));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  function pick(p: Place) {
    update({ aoi: { kind: "bbox", bbox: placeBbox(p) }, name: placeName(p), workspace: true, month: undefined });
    setResults(null);
    setQ("");
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  }

  const dataEnd = status?.data_end;
  const minDate = status?.data_start;

  return (
    <header className="no-print sticky top-0 z-[1000] border-b border-haze-200/80 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-3 px-4 py-2.5 lg:px-6">
        <button onClick={onHome} className="rounded-xl p-1 focus-visible:ring-2 focus-visible:ring-orbit-500" aria-label="KELVIN home">
          <Logo />
        </button>

        <form onSubmit={search} role="search" className="relative order-3 w-full md:order-none md:ml-4 md:w-[340px]">
          <label htmlFor="place" className="sr-only">Search a place</label>
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4">⌕</span>
          <input id="place" className="field pl-8 pr-20" placeholder="Search a place, e.g. Bathinda" value={q}
            onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          <button type="submit" className="btn-quiet absolute right-1 top-1/2 -translate-y-1/2 px-2.5 py-1 text-xs" disabled={busy}>
            {busy ? "…" : "Search"}
          </button>
          {results && (
            <ul role="listbox" aria-label="Search results" className="glass absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-auto p-1.5">
              {results.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">No places found.</li>}
              {results.map((p) => (
                <li key={p.display_name}>
                  <button type="button" role="option" aria-selected={false} onClick={() => pick(p)}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-haze-100 focus-visible:bg-haze-100">
                    {p.display_name}
                  </button>
                </li>
              ))}
              <li className="px-3 pb-1 pt-2 text-[10.5px] text-ink-4">Geocoding © OpenStreetMap contributors (Nominatim)</li>
            </ul>
          )}
        </form>

        <div className="relative" ref={menuRef}>
          <button className="btn-ghost" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <span aria-hidden>◎</span> Regions <span aria-hidden className="text-ink-4">▾</span>
          </button>
          {menu && (
            <div role="menu" className="glass absolute left-0 top-full z-50 mt-2 w-80 p-1.5">
              {regions.map((r) => (
                <button key={r.id} role="menuitem" disabled={!r.loaded}
                  onClick={() => { update({ aoi: { kind: "region", region: r.id }, name: r.name, workspace: true, month: undefined }); setMenu(false); }}
                  className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-haze-100 disabled:cursor-not-allowed disabled:opacity-45">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.loaded ? "bg-flame-500" : "bg-haze-300"}`} aria-hidden />
                  <span>
                    <span className="block text-sm font-medium text-ink">{r.name}</span>
                    <span className="block text-xs text-ink-4">{r.loaded ? r.blurb : "Not loaded. See README to fetch."}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="ml-auto flex items-center gap-1" aria-label="Help">
          <button className="btn-ghost hidden gap-2 md:inline-flex" onClick={onPalette} aria-keyshortcuts="Control+K Meta+K" title="Command palette">
            <span aria-hidden>⌘</span> Jump to… <kbd>Ctrl K</kbd>
          </button>
          <button className="btn-quiet hidden sm:inline-flex" onClick={onMethod}>Methodology</button>
          <button className="btn-quiet hidden sm:inline-flex" onClick={onLimits}>Limitations</button>
          <button className="btn-ghost" onClick={share} aria-live="polite">{copied ? "✓ Link copied" : "Share link"}</button>
        </nav>
      </div>

      {state.workspace && (
        <div className="border-t border-haze-200/70 bg-white/55">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 lg:px-6">
            <fieldset className="flex items-center gap-2">
              <legend className="eyebrow mr-1 float-left">Dates</legend>
              <label className="sr-only" htmlFor="start">Start date</label>
              <input id="start" type="date" className="field w-[148px] py-1.5" min={minDate} max={dataEnd}
                value={state.start ?? ""} onChange={(e) => update({ start: e.target.value || undefined })} />
              <span className="text-ink-4">→</span>
              <label className="sr-only" htmlFor="end">End date</label>
              <input id="end" type="date" className="field w-[148px] py-1.5" min={minDate} max={dataEnd}
                value={state.end ?? ""} onChange={(e) => update({ end: e.target.value || undefined })} />
              {(state.start || state.end) && (
                <button className="btn-quiet px-2 py-1 text-xs" onClick={() => update({ start: undefined, end: undefined })}>Full record</button>
              )}
            </fieldset>
            <div className="flex items-center gap-2">
              <span className="eyebrow">Metric</span>
              <Segmented<Metric> size="sm" label="Metric" value={state.metric} onChange={(metric) => update({ metric })} options={[
                { value: "cells", label: "Hotspots", title: "Harmonized hotspot cell-days (1 km cells with a detection, per day)" },
                { value: "detections", label: "Raw detections", title: "Fire-pixel detections" },
                { value: "frp", label: "FRP", title: "Summed fire radiative power (MW)" },
              ]} />
            </div>
            <div className="flex items-center gap-2">
              <span className="eyebrow">View</span>
              <Segmented<View> size="sm" label="Data view" value={state.view} onChange={(view) => update({ view })} options={[
                { value: "harmonized", label: "Harmonized" },
                { value: "modis", label: "MODIS native" },
                { value: "viirs", label: "VIIRS native" },
              ]} />
            </div>
            <div className="flex items-center gap-2">
              <label className="eyebrow" htmlFor="conf">Confidence</label>
              <select id="conf" className="field w-auto py-1.5" value={state.confidence}
                onChange={(e) => update({ confidence: e.target.value as Confidence })}>
                <option value="nominal">Nominal + high (default)</option>
                <option value="high">High only</option>
                <option value="all">All, incl. low</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
