// App state lives in the URL so every view is shareable.
import { useCallback, useEffect, useState } from "react";
import type { AoiShape, Confidence, Metric, Query, View } from "./api";

export type Tab = "calendar" | "seasons" | "trends" | "harmonization" | "jukebox" | "briefing";
export const TABS: { id: Tab; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "seasons", label: "Seasons" },
  { id: "trends", label: "Trends & rankings" },
  { id: "harmonization", label: "Harmonization" },
  { id: "jukebox", label: "Fire Jukebox" },
  { id: "briefing", label: "Briefing & downloads" },
];

export interface AppState {
  workspace: boolean;
  aoi: AoiShape | null;
  name?: string;
  start?: string;  // YYYY-MM-DD
  end?: string;
  metric: Metric;
  view: View;
  confidence: Confidence;
  baseline?: [number, number];
  tab: Tab;
  month?: string;  // selected calendar month YYYY-MM
}

const DEFAULTS: AppState = { workspace: false, aoi: null, metric: "cells", view: "harmonized", confidence: "nominal", tab: "calendar" };

const num = (s: string) => s.split(",").map(Number);
const ok = (a: number[], n: number) => a.length === n && a.every((v) => Number.isFinite(v));

export function parse(search: string): AppState {
  const p = new URLSearchParams(search);
  const s: AppState = { ...DEFAULTS };
  const r = p.get("r"), bb = p.get("bbox"), pt = p.get("pt"), geo = p.get("geo");
  if (r) s.aoi = { kind: "region", region: r };
  else if (bb && ok(num(bb), 4)) s.aoi = { kind: "bbox", bbox: num(bb) as [number, number, number, number] };
  else if (pt && ok(num(pt), 3)) { const [lon, lat, radius_km] = num(pt); s.aoi = { kind: "point", lon, lat, radius_km }; }
  else if (geo) {
    try {
      const ring = JSON.parse(geo) as [number, number][];
      if (Array.isArray(ring) && ring.length >= 4) s.aoi = { kind: "geojson", geojson: { type: "Polygon", coordinates: [ring] } };
    } catch { /* ignore malformed */ }
  }
  s.workspace = p.get("ws") === "1" || s.aoi !== null;
  s.name = p.get("name") ?? undefined;
  s.start = p.get("start") ?? undefined;
  s.end = p.get("end") ?? undefined;
  const m = p.get("metric"); if (m === "cells" || m === "detections" || m === "frp") s.metric = m;
  const v = p.get("view"); if (v === "harmonized" || v === "modis" || v === "viirs") s.view = v;
  const c = p.get("conf"); if (c === "all" || c === "nominal" || c === "high") s.confidence = c;
  const b = p.get("base"); if (b && ok(num(b), 2)) s.baseline = num(b) as [number, number];
  const t = p.get("tab"); if (t && ["calendar", "seasons", "trends", "harmonization", "jukebox", "briefing"].includes(t)) s.tab = t as Tab;
  const mo = p.get("month"); if (mo && /^\d{4}-\d{2}$/.test(mo)) s.month = mo;
  return s;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function serialize(s: AppState): string {
  const p = new URLSearchParams();
  const a = s.aoi;
  if (a?.kind === "region") p.set("r", a.region);
  if (a?.kind === "bbox") p.set("bbox", a.bbox.map(r4).join(","));
  if (a?.kind === "point") p.set("pt", [r4(a.lon), r4(a.lat), Math.round(a.radius_km * 10) / 10].join(","));
  if (a?.kind === "geojson" && a.geojson.type === "Polygon")
    p.set("geo", JSON.stringify((a.geojson.coordinates[0] as number[][]).map(([x, y]) => [r4(x), r4(y)])));
  if (s.workspace && !a) p.set("ws", "1");
  if (s.name) p.set("name", s.name);
  if (s.start) p.set("start", s.start);
  if (s.end) p.set("end", s.end);
  if (s.metric !== "cells") p.set("metric", s.metric);
  if (s.view !== "harmonized") p.set("view", s.view);
  if (s.confidence !== "nominal") p.set("conf", s.confidence);
  if (s.baseline) p.set("base", s.baseline.join(","));
  if (s.tab !== "calendar") p.set("tab", s.tab);
  if (s.month) p.set("month", s.month);
  const q = p.toString().replace(/%2C/g, ","); // readable share links
  return q ? `?${q}` : "";
}

export function useAppState(): [AppState, (patch: Partial<AppState>, replace?: boolean) => void] {
  const [state, setState] = useState<AppState>(() => parse(window.location.search));
  useEffect(() => {
    const onPop = () => setState(parse(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const update = useCallback((patch: Partial<AppState>, replace = false) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      const url = window.location.pathname + serialize(next);
      if (replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
      return next;
    });
  }, []);
  return [state, update];
}

export function toQuery(s: AppState): Query | null {
  if (!s.aoi) return null;
  return { aoi: s.aoi, name: s.name, start: s.start, end: s.end, metric: s.metric, view: s.view, confidence: s.confidence, baseline: s.baseline };
}

export function queryKey(q: Query | null): string {
  return q ? JSON.stringify(q) : "";
}
