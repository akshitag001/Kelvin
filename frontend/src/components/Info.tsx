import type { Status } from "../lib/api";
import { Modal } from "./ui";

export function Methodology({ open, onClose, status }: { open: boolean; onClose: () => void; status: Status | null }) {
  const h = status?.harmonization;
  return (
    <Modal open={open} onClose={onClose} title="Methodology">
      <p>KELVIN turns the MODIS (2000–) and VIIRS (2012–) active-fire records from NASA FIRMS into one series in <b>MODIS-equivalent hotspot cell-days</b>, so the sensor of origin no longer matters.</p>
      <h3 className="h-display pt-2 text-lg">1. Cleaning</h3>
      <p>Low-confidence detections are dropped by default (MODIS confidence below 30, VIIRS "l"). Where FIRMS provides a <i>type</i> column, only presumed vegetation fires (type 0) are kept, which removes volcanoes, gas flares and industrial heat. Exact duplicates are removed and science-quality (SP) data replaces near-real-time (NRT) data whenever both exist. Dates are the UTC acquisition date.</p>
      <h3 className="h-display pt-2 text-lg">2. A common unit</h3>
      <p>Every detection is assigned to a ~1 km equal-area cell on the MODIS sinusoidal grid (R = 6,371,007 m). A <b>cell-day</b> is a cell with at least one detection that day from a given sensor family. Counting cells rather than pixels removes most of the 375 m vs 1 km resolution difference; counting days rather than overpasses removes most of the effect of different numbers of satellites.</p>
      <h3 className="h-display pt-2 text-lg">3. Calibration</h3>
      <p>Over the overlap window ({h?.calibration_start ?? "2012-02-01"} to {h?.calibration_end ?? "2021-12-31"}) a factor <i>k</i> = ΣMODIS / ΣVIIRS (Suomi NPP reference) is estimated per 1° block and season, with hierarchical shrinkage: block-seasons with little data borrow strength from their block, then the 10° region, then the global value. A bootstrap over years gives a 90% interval. NOAA-20 and NOAA-21 are chained to Suomi NPP over their own overlaps. The window ends in 2021 because the MODIS orbits have drifted from their original overpass times since then.</p>
      <h3 className="h-display pt-2 text-lg">4. Assembly</h3>
      <p>Before {h?.switch_date ?? "2022-01-01"}: MODIS (Terra or Aqua). From then on: <i>k</i> × VIIRS. The two are never added. Before Aqua's first full month (August 2002) only Terra flew, so those months are scaled by a Terra → (Terra or Aqua) factor and marked <i>estimated</i>.</p>
      <h3 className="h-display pt-2 text-lg">5. Validation</h3>
      <p>Leave-one-year-out cross-validation: each calibration year is held out, <i>k</i> is refitted on the rest, and that year's MODIS series is predicted from VIIRS. Weighted error, MAPE, bias, R² and Spearman rank correlation are reported per region in the Harmonization tab.</p>
      <h3 className="h-display pt-2 text-lg">6. Anomalies</h3>
      <p>Each month is compared with the same calendar month in the baseline years (default: every complete year before the current one): ratio to median, empirical percentile, and robust z-score (x − median) / (1.4826 · MAD). The current month is compared <i>to date</i> with the same days of the month in each baseline year, never with full months. Trends use the Theil–Sen slope and the Mann–Kendall test on complete years.</p>
      <p className="text-sm text-ink-4">Harmonization version {h?.version ?? "kelvin-h1.0"}. The full write-up is in docs/METHODOLOGY.md in the repository.</p>
    </Modal>
  );
}

export const LIMITATIONS: [string, string][] = [
  ["A hotspot is not a fire count", "One fire can light up many cells over many days, and several small fires can share one cell. Hotspots are not burned area and say nothing about cause."],
  ["Clouds and smoke hide fires", "Satellites cannot see through thick cloud or dense smoke, so cloudy seasons are undercounted. This affects both sensors, but not always equally."],
  ["Overpass timing and the daily fire cycle", "Polar orbiters see each place only a few times a day. Fires that start and stop between passes are missed, and the MODIS orbits have drifted in recent years."],
  ["Small fires below MODIS detection", "VIIRS sees fires that MODIS cannot. Scaling corrects the average difference, not every individual small fire; years dominated by tiny fires carry more uncertainty."],
  ["Static heat sources", "Gas flares, kilns and volcanoes are removed only where FIRMS provides a type flag (science-quality data). Near-real-time data has no type flag."],
  ["Near-real-time data is provisional", "Recent days come from NRT processing and will be replaced by science-quality data months later. They are marked provisional."],
  ["Calibration is regional", "Factors are fitted per 1° block and season; areas with few overlapping detections fall back to broader averages. The level used is shown in the Harmonization tab."],
  ["Terra-only months are estimated", "Before August 2002 only Terra flew. Those months are scaled up with a factor learned from 2003–2006 and are hatched in the calendar."],
];

export function Limitations({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Limitations">
      <p>Read these before acting on any number in KELVIN.</p>
      <ul className="space-y-3">
        {LIMITATIONS.map(([t, d]) => (
          <li key={t} className="rounded-xl border border-haze-200 bg-white px-4 py-3">
            <b className="text-ink">{t}.</b> {d}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function Footer({ status, onMethod, onLimits }: { status: Status | null; onMethod: () => void; onLimits: () => void }) {
  return (
    <footer className="no-print border-t border-haze-200 bg-white/60">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-5 text-[12px] text-ink-4 lg:px-6">
        <p className="max-w-3xl">
          Data: NASA FIRMS (LANCE/EOSDIS), MODIS and VIIRS active fire detections. NASA does not endorse this project. Hotspots are detections, not confirmed fires.
          {status?.last_refresh && <> Last refresh {status.last_refresh.slice(0, 10)}.</>}
        </p>
        <div className="flex items-center gap-3">
          <button className="underline-offset-2 hover:text-ink hover:underline" onClick={onMethod}>Methodology</button>
          <button className="underline-offset-2 hover:text-ink hover:underline" onClick={onLimits}>Limitations</button>
          <a className="underline-offset-2 hover:text-ink hover:underline" href="https://github.com/akshitag001/Kelvin">Source</a>
          <span className="num">v{status?.version ?? "1.0.0"} · NASA Space Apps 2026</span>
        </div>
      </div>
    </footer>
  );
}
