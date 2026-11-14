import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import { useEffect, useRef, useState } from "react";
import { scaleSequential, scaleSequentialLog } from "d3-scale";
import { interpolateCividis, interpolateYlOrRd } from "d3-scale-chromatic";
import { api, type AoiShape, type HotspotFC, type Query, type Region, type Status } from "../lib/api";
import { ymLabel } from "../lib/format";
import type { AppState } from "../lib/state";
import { Segmented } from "./ui";

interface Props {
  state: AppState;
  query: Query | null;
  status: Status | null;
  regions: Region[];
  update: (p: Partial<AppState>) => void;
}

function aoiLayer(a: AoiShape, regions: Region[]): L.Layer | null {
  const style = { color: "#D92D20", weight: 2.2, fillColor: "#F04438", fillOpacity: 0.06, dashArray: undefined };
  if (a.kind === "region") {
    const r = regions.find((x) => x.id === a.region);
    if (!r) return null;
    const [w, s, e, n] = r.bbox;
    return L.rectangle([[s, w], [n, e]], style);
  }
  if (a.kind === "bbox") {
    const [w, s, e, n] = a.bbox;
    return L.rectangle([[s, w], [n, e]], style);
  }
  if (a.kind === "point") return L.circle([a.lat, a.lon], { ...style, radius: a.radius_km * 1000 });
  return L.geoJSON(a.geojson as GeoJSON.GeoJsonObject, { style: () => style });
}

export function MapPanel({ state, query, status, regions, update }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const aoiGroup = useRef<L.LayerGroup>(L.layerGroup());
  const hotGroup = useRef<L.LayerGroup>(L.layerGroup());
  const covGroup = useRef<L.LayerGroup>(L.layerGroup());
  const [colorBy, setColorBy] = useState<"frp" | "year">("frp");
  const [hot, setHot] = useState<HotspotFC | null>(null);
  const [hotErr, setHotErr] = useState<string | null>(null);
  const [showHot, setShowHot] = useState(true);
  const [form, setForm] = useState(false);
  const updateRef = useRef(update);
  updateRef.current = update;

  // ---- time-lapse: step through the 12 months of a year, one hotspot frame per month
  const lastYear = status?.data_end ? Number(status.data_end.slice(0, 4)) : new Date().getFullYear();
  const firstYear = status?.data_start ? Number(status.data_start.slice(0, 4)) + 1 : 2001;
  const [lapse, setLapse] = useState<{ year: number; idx: number; playing: boolean } | null>(null);
  const [hotFor, setHotFor] = useState<string | undefined>();
  const lapseMonth = lapse ? `${lapse.year}-${String(lapse.idx + 1).padStart(2, "0")}` : undefined;
  const viewMonth = lapseMonth ?? state.month;

  // ---- create the map once
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: [24, 40], zoom: 2, minZoom: 2, worldCopyJump: true, preferCanvas: true, zoomControl: true });
    // Esri Light Gray Canvas: a quiet, keyless light basemap (CARTO tiles now need an API key)
    const esriGray = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_";
    const grayBase = L.tileLayer(`${esriGray}Base/MapServer/tile/{z}/{y}/{x}`, {
      attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16,
    });
    const labelPane = m.createPane("labels"); // place names above the hotspot dots, never blocking clicks
    labelPane.style.zIndex = "450";
    labelPane.style.pointerEvents = "none";
    const grayLabels = L.tileLayer(`${esriGray}Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: "labels" });
    const light = L.layerGroup([grayBase, grayLabels]).addTo(m);
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
    });
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 18,
    });
    covGroup.current.addTo(m);
    hotGroup.current.addTo(m);
    aoiGroup.current.addTo(m);
    L.control.layers({ "Light gray": light, "OpenStreetMap": osm, "Satellite": sat },
      { "Loaded coverage": covGroup.current, "Hotspots": hotGroup.current }, { position: "topright" }).addTo(m);
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(m);
    map.current = m;

    // leaflet-draw reads the global L, so load it after Leaflet is ready
    (window as unknown as { L: typeof L }).L = L;
    void import("leaflet-draw").then(() => {
      const drawn = new L.FeatureGroup().addTo(m);
      const shape = { color: "#D92D20", weight: 2, fillOpacity: 0.06 };
      const ctl = new L.Control.Draw({
        position: "topleft",
        draw: {
          polyline: false, marker: false, circlemarker: false,
          // showArea: false avoids a leaflet-draw 1.0.4 bug in the rectangle tooltip
          rectangle: { shapeOptions: shape, showArea: false } as L.DrawOptions.RectangleOptions,
          polygon: { shapeOptions: shape, allowIntersection: false, showArea: false },
          circle: { shapeOptions: shape, showRadius: true, metric: true },
        },
        edit: { featureGroup: drawn, edit: false, remove: false },
      });
      m.addControl(ctl);
      m.on(L.Draw.Event.CREATED, (ev) => {
        const e = ev as L.DrawEvents.Created;
        const layer = e.layer;
        let aoi: AoiShape | null = null;
        if (e.layerType === "rectangle") {
          const b = (layer as L.Rectangle).getBounds();
          aoi = { kind: "bbox", bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number, number] };
        } else if (e.layerType === "circle") {
          const c = layer as L.Circle;
          aoi = { kind: "point", lon: c.getLatLng().lng, lat: c.getLatLng().lat, radius_km: Math.round(c.getRadius() / 100) / 10 };
        } else if (e.layerType === "polygon") {
          const gj = (layer as L.Polygon).toGeoJSON().geometry as GeoJSON.Polygon;
          aoi = { kind: "geojson", geojson: gj };
        }
        if (aoi) updateRef.current({ aoi, name: undefined, workspace: true, month: undefined });
      });
    });
    return () => { m.remove(); map.current = null; };
  }, []);

  // ---- coverage outlines
  useEffect(() => {
    const g = covGroup.current;
    g.clearLayers();
    for (const b of status?.coverage_boxes ?? []) {
      const [w, s, e, n] = b.bbox;
      L.rectangle([[s, w], [n, e]], { color: "#5B6CF0", weight: 1.2, dashArray: "4 5", fill: true, fillOpacity: 0.025, interactive: true })
        .bindTooltip(`${b.name} · data loaded`, { sticky: true })
        .addTo(g);
    }
  }, [status]);

  // ---- AOI outline and fit
  const aoiKey = JSON.stringify(state.aoi);
  useEffect(() => {
    const g = aoiGroup.current;
    g.clearLayers();
    if (!state.aoi || !map.current) return;
    const layer = aoiLayer(state.aoi, regions);
    if (!layer) return;
    layer.addTo(g);
    const b = (layer as L.FeatureGroup).getBounds?.();
    if (b?.isValid()) map.current.fitBounds(b.pad(0.08), { animate: true, maxZoom: 11 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aoiKey, regions]);

  // ---- hotspots for the selected month (or the date range)
  const qKey = query ? JSON.stringify({ a: query.aoi, s: query.start, e: query.end, c: query.confidence, m: viewMonth }) : "";
  useEffect(() => {
    if (!query) { setHot(null); return; }
    const ctrl = new AbortController();
    setHotErr(null);
    api.hotspots(query, { month: viewMonth }, ctrl.signal).then((r) => { setHot(r); setHotFor(viewMonth); }).catch((e) => {
      if (e.name !== "AbortError") setHotErr(e.message);
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey]);

  // advance the time-lapse once the current frame has loaded
  useEffect(() => {
    if (!lapse?.playing || hotFor !== lapseMonth) return;
    const id = window.setTimeout(() => setLapse((l) => l && (l.idx >= 11 ? { ...l, playing: false } : { ...l, idx: l.idx + 1 })), 1150);
    return () => window.clearTimeout(id);
  }, [lapse, hotFor, lapseMonth]);
  useEffect(() => { setLapse(null); }, [aoiKey]);

  useEffect(() => {
    const g = hotGroup.current;
    g.clearLayers();
    if (!hot || !showHot || !map.current) return;
    const renderer = L.canvas({ padding: 0.3 });
    const years = hot.features.map((f) => f.properties.year);
    const y0 = Math.min(...years, 2000), y1 = Math.max(...years, 2001);
    const yearC = scaleSequential((t: number) => interpolateCividis(t)).domain([y0, y1]);
    if (hot.mode === "points") {
      const frpC = scaleSequentialLog((t: number) => interpolateYlOrRd(0.25 + t * 0.75)).domain([1, 500]).clamp(true);
      for (const f of hot.features) {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const fill = colorBy === "frp" ? frpC(Math.max(1, p.frp ?? 1)) : yearC(p.year);
        L.circleMarker([lat, lon], { renderer, radius: 4, weight: 0.8, color: "#ffffff", fillColor: fill, fillOpacity: 0.92 })
          .bindPopup(`<div style="font:13px Inter,sans-serif;line-height:1.5"><b>${p.date}</b> ${p.time} UTC<br/>${p.satellite} · FRP ${p.frp ?? "–"} MW${p.provisional ? "<br/><i>provisional (NRT)</i>" : ""}</div>`)
          .addTo(g);
      }
    } else {
      const ns = hot.features.map((f) => f.properties.n ?? 1);
      const nMax = Math.max(...ns, 2);
      const nC = scaleSequentialLog((t: number) => interpolateYlOrRd(0.2 + t * 0.8)).domain([1, nMax]);
      const frpMax = Math.max(...hot.features.map((f) => (f.properties.frp ?? 0) / (f.properties.n ?? 1)), 2);
      const frpC = scaleSequentialLog((t: number) => interpolateYlOrRd(0.2 + t * 0.8)).domain([1, frpMax]).clamp(true);
      for (const f of hot.features) {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const n = p.n ?? 1;
        const fill = colorBy === "frp" ? frpC(Math.max(1, (p.frp ?? 0) / n)) : nC(n);
        // small, translucent dots so dense areas build up colour instead of merging into one slab
        L.circleMarker([lat, lon], { renderer, radius: 1 + 3.2 * Math.sqrt(n / nMax), weight: 0, fillColor: fill, fillOpacity: 0.32 + 0.5 * Math.sqrt(n / nMax) })
          .bindTooltip(`${n.toLocaleString()} detections`, { direction: "top" })
          .addTo(g);
      }
    }
  }, [hot, colorBy, showHot]);

  const caption = viewMonth ? `Hotspots in ${ymLabel(viewMonth)}` : state.start || state.end ? "Hotspots in the selected dates" : "All hotspots in the record";
  const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-haze-200 bg-white shadow-glass">
      <div className="flex flex-wrap items-center gap-2 border-b border-haze-200 px-3 py-2">
        <div className="mr-auto min-w-0">
          <div className="eyebrow">Map</div>
          <div className="truncate text-[13px] font-medium text-ink-2" aria-live="polite">
            {query ? `${caption}: ${hot ? hot.count.toLocaleString() : "…"} ${hot?.mode === "grid" ? "(gridded)" : ""}` : "Draw a rectangle, polygon or circle, or pick a region"}
          </div>
        </div>
        {state.month && <button className="btn-quiet px-2 py-1 text-xs" onClick={() => update({ month: undefined })}>Show all months</button>}
        <Segmented<"frp" | "year"> size="sm" label="Color hotspots by" value={colorBy} onChange={setColorBy}
          options={[{ value: "frp", label: "FRP" }, { value: "year", label: hot?.mode === "grid" ? "Count" : "Year" }]} />
        <button className={`btn-ghost px-2.5 py-1 text-xs ${showHot ? "" : "opacity-60"}`} aria-pressed={showHot} onClick={() => setShowHot((v) => !v)}>
          {showHot ? "Hide" : "Show"} points
        </button>
        {query && !lapse && (
          <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setLapse({ year: lastYear - 1, idx: 0, playing: true })}
            title="Play a year of hotspots, month by month">▶ Time-lapse</button>
        )}
        <button className="btn-primary px-3 py-1 text-xs" aria-expanded={form} onClick={() => setForm((f) => !f)}>Enter coordinates</button>
      </div>
      {form && <AoiForm onDone={() => setForm(false)} update={update} />}
      <div className="relative flex-1">
        <div ref={el} className="absolute inset-0" role="application" aria-label="Map. Use the draw tools at the top left, or the Enter coordinates button for a keyboard-friendly form." />
        <Legend colorBy={colorBy} grid={hot?.mode === "grid"} />
        {lapse && (
          <div className="absolute left-1/2 top-3 z-[600] w-[min(440px,calc(100%-120px))] -translate-x-1/2 rounded-2xl border border-haze-200 bg-white/90 px-4 py-3 shadow-glass backdrop-blur"
            role="group" aria-label="Time-lapse">
            <div className="flex items-end justify-between gap-3">
              <div aria-live="polite">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-4">Time-lapse</div>
                <div className="num text-[26px] font-semibold leading-none text-ink">
                  {MON3[lapse.idx]} <span className="text-flame-600">{lapse.year}</span>
                </div>
              </div>
              <div className="num text-right text-[12px] text-ink-3">
                {hotFor === lapseMonth && hot ? <><b className="text-[15px] text-ink">{hot.count.toLocaleString()}</b> detections</> : "loading…"}
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <button className="btn-primary h-8 w-8 justify-center p-0 text-xs" aria-label={lapse.playing ? "Pause" : "Play"}
                onClick={() => setLapse({ ...lapse, playing: !lapse.playing, idx: !lapse.playing && lapse.idx >= 11 ? 0 : lapse.idx })}>
                {lapse.playing ? "❚❚" : "▶"}
              </button>
              <div className="flex flex-1 gap-[3px]" role="radiogroup" aria-label="Month">
                {MON3.map((m, i) => (
                  <button key={m} role="radio" aria-checked={i === lapse.idx} aria-label={m} title={m}
                    onClick={() => setLapse({ ...lapse, idx: i, playing: false })}
                    className={`h-2 flex-1 rounded-full transition ${i < lapse.idx ? "bg-flame-300" : i === lapse.idx ? "bg-flame-600" : "bg-haze-200 hover:bg-haze-300"}`} />
                ))}
              </div>
              <label className="sr-only" htmlFor="lapse-year">Year</label>
              <select id="lapse-year" className="field w-auto px-2 py-1 text-xs" value={lapse.year}
                onChange={(e) => setLapse({ year: Number(e.target.value), idx: 0, playing: true })}>
                {Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button className="btn-quiet px-2 py-1 text-xs" aria-label="Close time-lapse" onClick={() => setLapse(null)}>✕</button>
            </div>
          </div>
        )}
        {hotErr && <div className="absolute bottom-10 left-3 rounded-lg bg-white/90 px-3 py-1.5 text-xs text-flame-700 shadow">Hotspots: {hotErr}</div>}
      </div>
    </div>
  );
}

function Legend({ colorBy, grid }: { colorBy: "frp" | "year"; grid: boolean }) {
  const label = colorBy === "frp" ? (grid ? "Mean FRP per detection (MW)" : "Fire radiative power (MW)") : grid ? "Detections per grid cell" : "Year of detection";
  const grad = colorBy === "year" && !grid
    ? "linear-gradient(90deg,#00224e,#575d6d,#a59c74,#fee838)"
    : "linear-gradient(90deg,#fed976,#feb24c,#fd8d3c,#f03b20,#bd0026)";
  return (
    <div className="pointer-events-none absolute bottom-6 left-3 z-[500] rounded-xl border border-haze-200 bg-white/90 px-3 py-2 shadow-glass backdrop-blur">
      <div className="text-[11px] font-medium text-ink-2">{label}</div>
      <div className="mt-1 h-2 w-40 rounded-full" style={{ background: grad }} />
      <div className="mt-0.5 flex justify-between text-[10px] text-ink-4"><span>low</span><span>high</span></div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-4">
        <span className="inline-block h-0 w-4 border-t border-dashed border-orbit-500" /> loaded data coverage
      </div>
    </div>
  );
}

export function AoiForm({ update, onDone }: { update: (p: Partial<AppState>) => void; onDone: () => void }) {
  const [mode, setMode] = useState<"bbox" | "point" | "file">("bbox");
  const [bbox, setBbox] = useState({ w: "", s: "", e: "", n: "" });
  const [pt, setPt] = useState({ lat: "", lon: "", r: "50" });
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (mode === "bbox") {
      const v = [bbox.w, bbox.s, bbox.e, bbox.n].map(Number);
      if (v.some((x, i) => !Number.isFinite(x) || [bbox.w, bbox.s, bbox.e, bbox.n][i] === "")) return setErr("Enter all four numbers.");
      if (v[0] >= v[2] || v[1] >= v[3]) return setErr("West must be less than east, and south less than north.");
      if (v[0] < -180 || v[2] > 180 || v[1] < -90 || v[3] > 90) return setErr("Longitude is -180..180, latitude -90..90.");
      update({ aoi: { kind: "bbox", bbox: v as [number, number, number, number] }, name: undefined, workspace: true, month: undefined });
    } else if (mode === "point") {
      const lat = Number(pt.lat), lon = Number(pt.lon), r = Number(pt.r);
      if (![lat, lon, r].every(Number.isFinite) || pt.lat === "" || pt.lon === "") return setErr("Enter latitude, longitude and radius.");
      if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return setErr("Latitude must be within ±85, longitude within ±180.");
      if (r <= 0 || r > 1500) return setErr("Radius must be between 0 and 1500 km.");
      update({ aoi: { kind: "point", lat, lon, radius_km: r }, name: undefined, workspace: true, month: undefined });
    }
    onDone();
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr(null);
    try {
      const gj = JSON.parse(await f.text());
      const geom: GeoJSON.Geometry | undefined =
        gj.type === "FeatureCollection" ? gj.features?.[0]?.geometry : gj.type === "Feature" ? gj.geometry : gj;
      if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) throw new Error("The file needs a Polygon or MultiPolygon.");
      update({ aoi: { kind: "geojson", geojson: geom }, name: f.name.replace(/\.(geo)?json$/i, ""), workspace: true, month: undefined });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read that file.");
    }
  }

  const num = "field py-1.5 num";
  return (
    <form onSubmit={submit} aria-label="Area of interest" className="border-b border-haze-200 bg-haze-50/80 px-3 py-3">
      <div className="mb-3">
        <Segmented<"bbox" | "point" | "file"> size="sm" label="Input type" value={mode} onChange={setMode}
          options={[{ value: "bbox", label: "Bounding box" }, { value: "point", label: "Point + radius" }, { value: "file", label: "GeoJSON file" }]} />
      </div>
      {mode === "bbox" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["w", "s", "e", "n"] as const).map((k) => (
            <label key={k} className="text-xs text-ink-3">
              {{ w: "West (lon)", s: "South (lat)", e: "East (lon)", n: "North (lat)" }[k]}
              <input className={num} inputMode="decimal" value={bbox[k]} onChange={(e) => setBbox({ ...bbox, [k]: e.target.value })}
                placeholder={{ w: "73.8", s: "27.6", e: "77.6", n: "32.6" }[k]} />
            </label>
          ))}
        </div>
      )}
      {mode === "point" && (
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-ink-3">Latitude<input className={num} inputMode="decimal" value={pt.lat} onChange={(e) => setPt({ ...pt, lat: e.target.value })} placeholder="30.21" /></label>
          <label className="text-xs text-ink-3">Longitude<input className={num} inputMode="decimal" value={pt.lon} onChange={(e) => setPt({ ...pt, lon: e.target.value })} placeholder="74.95" /></label>
          <label className="text-xs text-ink-3">Radius (km)<input className={num} inputMode="decimal" value={pt.r} onChange={(e) => setPt({ ...pt, r: e.target.value })} /></label>
        </div>
      )}
      {mode === "file" && (
        <label className="block text-xs text-ink-3">
          Upload a .geojson file with a polygon
          <input type="file" accept=".geojson,.json,application/geo+json,application/json" className="mt-1 block w-full text-sm"
            onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      )}
      {err && <p role="alert" className="mt-2 text-xs font-medium text-flame-700">{err}</p>}
      {mode !== "file" && (
        <div className="mt-3 flex gap-2">
          <button type="submit" className="btn-primary px-3 py-1.5 text-xs">Analyze area</button>
          <button type="button" className="btn-quiet px-3 py-1.5 text-xs" onClick={onDone}>Cancel</button>
        </div>
      )}
    </form>
  );
}
