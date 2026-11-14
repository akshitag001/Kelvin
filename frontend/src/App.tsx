import { useEffect, useState } from "react";
import { Footer, Limitations, Methodology } from "./components/Info";
import { Header } from "./components/Header";
import { Home } from "./components/Home";
import { AnnouncerProvider } from "./components/ui";
import { Workspace } from "./components/Workspace";
import { api, type Region, type Status } from "./lib/api";
import { useAppState } from "./lib/state";

export default function App() {
  const [state, update] = useAppState();
  const [status, setStatus] = useState<Status | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState(false);
  const [limits, setLimits] = useState(false);

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
        onMethod={() => setMethod(true)} onLimits={() => setLimits(true)} />
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
    </AnnouncerProvider>
  );
}
