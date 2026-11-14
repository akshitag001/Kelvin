// Typed client for the KELVIN API.

export type Metric = "cells" | "detections" | "frp";
export type View = "harmonized" | "modis" | "viirs";
export type Confidence = "all" | "nominal" | "high";
export type AnomalyClass =
  | "record_high" | "much_above" | "above" | "normal" | "below" | "much_below" | "record_low" | "no_baseline";

export type AoiShape =
  | { kind: "region"; region: string }
  | { kind: "bbox"; bbox: [number, number, number, number] }
  | { kind: "point"; lon: number; lat: number; radius_km: number }
  | { kind: "geojson"; geojson: GeoJSON.Geometry };

export interface Query {
  aoi: AoiShape;
  name?: string;
  start?: string;
  end?: string;
  metric: Metric;
  view: View;
  confidence: Confidence;
  baseline?: [number, number];
}

export interface Warning { code: string; level: "error" | "warn" | "info"; text: string }

export interface MonthRow {
  ym: string; year: number; month: number;
  value: number | null; harmonized: number | null; lo: number | null; hi: number | null;
  modis: number | null; viirs: number | null; viirs_scaled: number | null; stitch: number | null;
  source: "MODIS" | "VIIRS"; flags: string[];
  median: number | null; ratio: number | null; percentile: number | null; z: number | null; cls: AnomalyClass | null;
}

export interface Envelope { month: number; min?: number; p10?: number; p25?: number; median?: number; p75?: number; p90?: number; max?: number; mean?: number; n?: number }

export interface Current {
  ym: string; year: number; month: number; as_of: string; days: number; full_month: boolean;
  value: number; provisional: boolean; headline: string; label: string; baseline_years: [number, number];
  median: number | null; ratio: number | null; percentile: number | null; z: number | null; cls: AnomalyClass; n: number;
  off_season?: boolean;
}

export interface GlobeData {
  as_of: string; window_months: number; max: number;
  points: [number, number, number, boolean][];
  last7: { from: string; to: string; detections: number; active_cells: number; by_satellite: Record<string, number> };
  regions: { id: string; name: string; bbox: [number, number, number, number] }[];
}

export interface Summary {
  aoi: { area_km2: number; bbox: [number, number, number, number]; cells: number; coverage_fraction: number; centroid: [number, number] };
  params: { start: string | null; end: string | null; metric: Metric; view: View; confidence: Confidence; unit: string; unit_long: string };
  data: { start: string; end: string; demo: boolean };
  baseline: { start_year: number; end_year: number };
  monthly: MonthRow[];
  years: number[];
  current: Current | null;
  seasonality: {
    by_month: Envelope[]; peak_month: number | null;
    season: { months: number[]; share: number; start: number | null; end: number | null };
    current_year: number; current: (number | null)[]; previous: (number | null)[];
  };
  annual: { year: number; total: number | null; months: number; complete: boolean; estimated: boolean }[];
  trend: { slope: number | null; intercept: number | null; slope_pct: number | null; p: number | null; tau: number | null; n: number; direction: string; wording: string };
  rankings: {
    months: { rank: number; ym: string; year: number; month: number; value: number; ratio: number | null; cls: AnomalyClass | null }[];
    years: { rank: number; year: number; total: number; months: number; complete: boolean; estimated: boolean }[];
  };
  peak: Summary["rankings"]["months"][number] | null;
  harmonization: {
    version: string; k: number | null; k_lo: number | null; k_hi: number | null; global_k: number | null;
    levels: Record<string, number>; dominant_level: string; switch_date: string; calibration_window: [string, string];
    terra_only_until: string; chain: Record<string, { factor: number; to: string; n_months: number }>; cv_region: string;
    cv: { mape: number | null; wmape: number | null; bias: number | null; r2: number | null; spearman: number | null; n_months: number } | null;
  };
  warnings: Warning[];
}

export interface DayRow {
  day: number; date: string; value: number | null; cumulative: number | null;
  min: number | null; p25: number | null; median: number | null; p75: number | null; max: number | null;
  cum_median: number | null; cum_p25: number | null; cum_p75: number | null; provisional: boolean;
}
export interface Daily {
  ym: string; year: number; month: number; days: DayRow[]; unit: string;
  to_date: (Current & { days: number; full_month: boolean }) | null;
  baseline: { start_year: number; end_year: number };
}

export interface Status {
  version: string; ready: boolean; demo: boolean | null; map_key: boolean; attribution: string; message?: string;
  built_at?: string; last_refresh?: string; data_start?: string; data_end?: string; detections?: number; cells?: number;
  coverage?: Record<string, { start: string; end: string; sp_end: string | null; nrt_start: string | null; detections: number }>;
  coverage_boxes?: { id: string; name: string; bbox: [number, number, number, number] }[];
  sp_nrt_boundary?: { sp_end: string | null; nrt_start: string | null };
  harmonization?: { version: string; switch_date: string; calibration_start: string; calibration_end: string; global_k: number | null };
}

export interface Region {
  id: string; name: string; bbox: [number, number, number, number]; priority: number; blurb: string;
  story: string | null; center: [number, number]; loaded: boolean; cells: number;
}

export interface LeaderRow {
  id: string; name: string; story: string | null; blurb: string; bbox: [number, number, number, number];
  value: number; median: number | null; ratio: number | null; percentile: number | null; cls: AnomalyClass; label: string;
  headline: string; provisional: boolean; peak_month: number | null; season: number[]; spark: (number | null)[]; rank: number;
  off_season?: boolean;
}

export interface Diagnostics {
  region: string; global_k: number | null; global_k_lo: number | null; global_k_hi: number | null; terra_global: number | null;
  chain: Record<string, { factor: number; to: string; n_months: number }>;
  calibration_window: [string, string]; switch_date: string;
  cv: { region: string; n_months: number; mape: number | null; wmape: number | null; bias: number | null; r2: number | null; spearman: number | null }[];
  scatter: { ym: number; modis: number; viirs_raw: number; viirs_scaled: number }[];
  k_table: { block_id: number; season: number; k: number; k_lo: number; k_hi: number; n_viirs: number; raw_ratio: number; level: string; lat: number; lon: number }[];
  k_by_season: { season: number; k: number; n: number }[];
  level_share: Record<string, number>;
  terra_factor: { month: number; f: number | null; n: number }[];
  demo: boolean;
}

export interface HotspotFC {
  type: "FeatureCollection"; mode: "points" | "grid"; count: number; cell_deg?: number;
  features: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] };
    properties: { date?: string; time?: string; satellite?: string; frp: number | null; year: number; provisional?: boolean; n?: number } }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function body(q: Query, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const a = q.aoi;
  const shape =
    a.kind === "region" ? { region: a.region }
    : a.kind === "bbox" ? { bbox: a.bbox }
    : a.kind === "point" ? { point: { lon: a.lon, lat: a.lat, radius_km: a.radius_km } }
    : { geojson: a.geojson };
  return {
    ...shape, name: q.name, start: q.start || undefined, end: q.end || undefined,
    metric: q.metric, view: q.view, confidence: q.confidence, baseline: q.baseline, ...extra,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: { msg: string }) => d.msg).join("; ") : msg;
    } catch { /* not JSON */ }
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

const post = <T,>(path: string, payload: unknown, signal?: AbortSignal) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });

export const api = {
  status: () => request<Status>("/api/status"),
  regions: () => request<Region[]>("/api/regions"),
  leaderboard: () => request<{ as_of: string; regions: LeaderRow[] }>("/api/leaderboard"),
  globe: () => request<GlobeData>("/api/globe"),
  summary: (q: Query, s?: AbortSignal) => post<Summary>("/api/aoi/summary", body(q), s),
  daily: (q: Query, month: string, s?: AbortSignal) => post<Daily>("/api/aoi/daily", body(q, { month }), s),
  briefing: (q: Query, s?: AbortSignal) => post<{ title: string; paragraphs: string[]; text: string }>("/api/aoi/briefing", body(q), s),
  hotspots: (q: Query, opts: { month?: string; color_by?: "frp" | "year" }, s?: AbortSignal) =>
    post<HotspotFC>("/api/aoi/hotspots", body(q, opts), s),
  diagnostics: (region: string, metric: Metric, confidence: Confidence) =>
    request<Diagnostics>(`/api/harmonization/diagnostics?region=${encodeURIComponent(region)}&metric=${metric}&confidence=${confidence}`),
  async download(path: "/api/aoi/hotspots.csv" | "/api/aoi/calendar.csv", q: Query, filename: string) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(q)) });
    if (!r.ok) throw new ApiError(r.status, `Download failed (${r.status})`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
