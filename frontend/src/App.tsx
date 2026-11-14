import { useEffect, useMemo, useState } from "react";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Footer, Limitations, Methodology } from "./components/Info";
import { Header } from "./components/Header";
import { Home } from "./components/Home";
import { AnnouncerProvider } from "./components/ui";
import { Workspace } from "./components/Workspace";
import { api, type Region, type Status } from "./lib/api";
import { TABS, useAppState } from "./lib/state";

export default function App() {
  const [state, update] = useAppState();
  const [status, setStatus] = useState<Status | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState(false);
  const [limits, setLimits] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (p: Parameters<typeof update>[0]) => () => update(p);
    const list: Command[] = regions.filter((r) => r.loaded).map((r) => ({
      id: `r-${r.id}`, group: "Regions", label: r.name, hint: r.story ?? undefined, icon: "◉", keywords: r.blurb,
      run: go({ aoi: { kind: "region", region: r.id }, name: r.name, workspace: true, month: undefined }),
    }));
    if (state.aoi) {
      list.push(...TABS.map((t) => ({ id: `t-${t.id}`, group: "Views", label: t.label, icon: "▤", run: go({ tab: t.id }) })));
      list.push(
        { id: "v-h", group: "Data", label: "Harmonized series", icon: "≋", keywords: "view", run: go({ view: "harmonized" }) },
        { id: "v-m", group: "Data", label: "MODIS native", icon: "≋", keywords: "view", run: go({ view: "modis" }) },
        { id: "v-v", group: "Data", label: "VIIRS native (unscaled)", icon: "≋", keywords: "view", run: go({ view: "viirs" }) },
        { id: "m-c", group: "Data", label: "Metric: hotspot cell-days", icon: "#", run: go({ metric: "cells" }) },
        { id: "m-d", group: "Data", label: "Metric: raw detections", icon: "#", run: go({ metric: "detections" }) },
        { id: "m-f", group: "Data", label: "Metric: fire radiative power", icon: "#", keywords: "frp", run: go({ metric: "frp" }) },
      );
    }
    list.push(
      { id: "a-home", group: "Go to", label: "Home and leaderboard", icon: "⌂", run: go({ workspace: false, aoi: null, name: undefined, month: undefined }) },
      { id: "a-map", group: "Go to", label: "Explore the map (draw an area)", icon: "✎", run: go({ workspace: true }) },
      { id: "a-method", group: "Go to", label: "Methodology", icon: "?", run: () => setMethod(true) },
      { id: "a-limits", group: "Go to", label: "Limitations", icon: "!", run: () => setLimits(true) },
      { id: "a-share", group: "Go to", label: "Copy share link", icon: "⧉", run: () => void navigator.clipboard?.writeText(window.location.href) },
    );
    return list;
  }, [regions, state.aoi, update]);

  useEffect(() => {
    Promise.all([api.status(), api.regions()])
      .then(([s, r]) => { setStatus(s); setRegions(r); })
      .catch(() => setErr("Cannot reach the KELVIN API. Start it with: python scripts/dev.py"));
  }, []);

  useEffect(() => {
    document.title = state.workspace && state.name ? `${state.name} · KELVIN` : "KELVIN · Harmonized Fire Activity Calendar";
  }, [state.workspace, state.name]);

  return (
    <AnnouncerProvider>
      <a href="#main" className="sr-only z-[3000] rounded-lg bg-ink px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      {status?.demo && (
        <div role="note" className="no-print relative z-[1001] border-b border-amber-300 text-center text-[12px] font-semibold tracking-wide text-amber-900"
          style={{ background: "repeating-linear-gradient(135deg,#FEF0C7 0 12px,#FFFAEB 12px 24px)" }}>
          <span className="inline-block px-3 py-1.5">SYNTHETIC DEMO DATA · not real fire detections · add a FIRMS key and run <code className="font-mono">python -m kelvin fetch</code> for real data</span>
        </div>
      )}
      <Header state={state} status={status} regions={regions} update={update}
        onHome={() => update({ workspace: false, aoi: null, name: undefined, month: undefined, tab: "calendar" })}
        onMethod={() => setMethod(true)} onLimits={() => setLimits(true)} onPalette={() => setPalette(true)} />
      {err && (
        <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-flame-500/30 bg-flame-50 px-5 py-4 text-sm text-flame-800" role="alert">{err}</div>
      )}
      {status && !status.ready && (
        <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900" role="alert">{status.message}</div>
      )}
      {state.workspace
        ? <Workspace state={state} status={status} regions={regions} update={update} />
        : <Home status={status} regions={regions} update={update} />}
      <Footer status={status} onMethod={() => setMethod(true)} onLimits={() => setLimits(true)} />
      <Methodology open={method} onClose={() => setMethod(false)} status={status} />
      <Limitations open={limits} onClose={() => setLimits(false)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands}
        onPlace={(bbox, name) => update({ aoi: { kind: "bbox", bbox }, name, workspace: true, month: undefined })} />
    </AnnouncerProvider>
  );
}
