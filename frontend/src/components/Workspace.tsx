import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Query, type Region, type Status, type Summary } from "../lib/api";
import { TABS, toQuery, type AppState, type Tab } from "../lib/state";
import { Briefing } from "./Briefing";
import { Calendar } from "./Calendar";
import { DailyDrill } from "./DailyDrill";
import { Harmonization } from "./Harmonization";
import { LIMITATIONS } from "./Info";
import { Jukebox } from "./Jukebox";
import { MapPanel } from "./MapPanel";
import { Seasons } from "./Seasons";
import { StatusBanner } from "./StatusBanner";
import { Trends } from "./Trends";
import { Notice, Skeleton, useAnnounce } from "./ui";

interface Props { state: AppState; status: Status | null; regions: Region[]; update: (p: Partial<AppState>, replace?: boolean) => void }

function areaName(state: AppState, regions: Region[]): string {
  if (state.name) return state.name;
  const a = state.aoi;
  if (!a) return "";
  if (a.kind === "region") return regions.find((r) => r.id === a.region)?.name ?? a.region;
  if (a.kind === "point") return `${a.radius_km} km around ${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}`;
  if (a.kind === "bbox") return `Box ${a.bbox.map((v) => v.toFixed(2)).join(", ")}`;
  return "Drawn area";
}

export function Workspace({ state, status, regions, update }: Props) {
  const query = useMemo(() => toQuery(state), [state.aoi, state.start, state.end, state.metric, state.view, state.confidence, state.baseline]); // eslint-disable-line react-hooks/exhaustive-deps
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const announce = useAnnounce();
  const name = areaName(state, regions);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!query) { setS(null); return; }
    const c = new AbortController();
    setLoading(true); setErr(null);
    api.summary(query, c.signal)
      .then((r) => { setS(r); announce(r.current?.headline ?? `Loaded ${name}`); })
      .catch((e) => { if (e.name !== "AbortError") setErr(e instanceof ApiError ? e.message : "Could not reach the KELVIN API. Is the backend running?"); })
      .finally(() => setLoading(false));
    return () => c.abort();
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (ym: string) => update({ month: ym, tab: "calendar" });
  const tabIdx = TABS.findIndex((t) => t.id === state.tab);
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const n = (tabIdx + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    update({ tab: TABS[n].id }, true);
    tabRefs.current[n]?.focus();
  };

  return (
    <main id="main" className="mx-auto grid max-w-[1680px] gap-4 px-4 py-4 lg:grid-cols-[minmax(380px,44%)_1fr] lg:px-6">
      <div className="no-print h-[56vh] lg:sticky lg:top-[118px] lg:h-[calc(100vh-134px)]">
        <MapPanel state={state} query={query} status={status} regions={regions} update={update} />
      </div>

      <div className="min-w-0 space-y-4">
        {!query && <EmptyState regions={regions} update={update} />}
        {query && err && <Notice level="error">{err}</Notice>}
        {query && !s && loading && <div className="space-y-4"><Skeleton className="h-[150px]" /><Skeleton className="h-[52px]" /><Skeleton className="h-[520px]" /></div>}
        {query && s && (
          <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            <StatusBanner s={s} name={name} />
            <div role="tablist" aria-label="Analysis views" onKeyDown={onTabKey}
              className="no-print scrollbar-thin glass flex gap-1 overflow-x-auto p-1.5">
              {TABS.map((t, i) => (
                <button key={t.id} ref={(el) => (tabRefs.current[i] = el)} role="tab" id={`tab-${t.id}`} aria-selected={state.tab === t.id}
                  aria-controls={`panel-${t.id}`} tabIndex={state.tab === t.id ? 0 : -1} onClick={() => update({ tab: t.id as Tab }, true)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-[13px] font-medium transition ${
                    state.tab === t.id ? "bg-ink text-white shadow" : "text-ink-3 hover:bg-haze-100 hover:text-ink"}`}>
                  <TabIcon id={t.id as Tab} />{t.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${state.tab}`} aria-labelledby={`tab-${state.tab}`} className="space-y-4">
              {state.tab === "calendar" && (<>
                <Calendar s={s} selected={state.month} onSelect={select} />
                {state.month && query && <DailyDrill query={query as Query} ym={state.month} onClose={() => update({ month: undefined })} />}
              </>)}
              {state.tab === "seasons" && <Seasons s={s} />}
              {state.tab === "trends" && <Trends s={s} onSelect={select} />}
              {state.tab === "harmonization" && (<>
                <Harmonization s={s} />
                <section className="card" aria-labelledby="lim">
                  <h3 id="lim" className="h-display mb-3 text-[17px]">Limitations</h3>
                  <ul className="grid gap-2 text-[13px] leading-relaxed text-ink-3 md:grid-cols-2">
                    {LIMITATIONS.map(([t, d]) => <li key={t}><b className="text-ink-2">{t}.</b> {d}</li>)}
                  </ul>
                </section>
              </>)}
              {state.tab === "jukebox" && <Jukebox s={s} />}
              {state.tab === "briefing" && query && <Briefing q={query} s={s} name={name} />}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const TAB_PATHS: Record<Tab, string> = {
  calendar: "M3 5h14v12H3zM3 9h14M7 3v4M13 3v4",
  seasons: "M2 14c3 0 3-8 6-8s3 10 6 10 3-6 4-6",
  trends: "M3 16V9M8 16V5M13 16v-5M18 16V3",
  harmonization: "M2 7h7l2 6h7M2 13h5M13 7h5",
  jukebox: "M7 15V4l9-2v11M7 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM16 13a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  briefing: "M5 2h7l4 4v12H5zM12 2v4h4M8 10h5M8 13h5",
};

function TabIcon({ id }: { id: Tab }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={TAB_PATHS[id]} />
    </svg>
  );
}

function EmptyState({ regions, update }: { regions: Region[]; update: Props["update"] }) {
  return (
    <section className="glass relative overflow-hidden p-8">
      <div aria-hidden className="starfield absolute inset-0 opacity-70" />
      <div className="relative">
        <div className="eyebrow mb-2">Choose an area</div>
        <h2 className="h-display text-[28px] leading-tight">Draw on the map, enter coordinates, or pick a region.</h2>
        <p className="mt-3 max-w-xl text-[14.5px] text-ink-3">Use the rectangle, polygon or circle tools at the top left of the map. The <b>Enter coordinates</b> button opens a keyboard-friendly form, and you can upload a GeoJSON polygon too.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {regions.filter((r) => r.loaded).map((r) => (
            <button key={r.id} className="btn-ghost" onClick={() => update({ aoi: { kind: "region", region: r.id }, name: r.name, month: undefined })}>
              <span className="h-1.5 w-1.5 rounded-full bg-flame-500" aria-hidden />{r.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
