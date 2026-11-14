<div align="center">

<img src="frontend/public/favicon.svg" width="72" alt="KELVIN logo" />

# KELVIN

**Earth's heat, measured from orbit.**
Twenty-five years of fire, one consistent calendar, and you can hear it.

*NASA Space Apps Challenge 2026 · "MODIS and VIIRS Hot Spots"*

</div>

---

KELVIN merges the **MODIS** (Terra/Aqua, 1 km, since 2000) and **VIIRS** (Suomi NPP, NOAA-20, NOAA-21, 375 m, since 2012) active-fire records from **NASA FIRMS** into one **harmonized** hotspot series. With a single record, a jump in the data reflects a change on the ground rather than a change of satellite.

Pick any area (draw it, type coordinates, upload GeoJSON, or search a place) and KELVIN gives you:

- **A burning activity calendar**: years × months heatmap, with the count printed in every cell, plus an anomaly view against the historical median.
- **An emergency-manager status banner**, e.g. *"November 2026 so far: 1.4× the historical median (88th percentile), above normal."* The current month is always compared *to date*, never against full months.
- **Seasonality, trends and rankings**: monthly envelope, fire-season window, Theil–Sen trend with a Mann–Kendall test, and the top months and years.
- **Visible validation**: native-vs-harmonized overlay, out-of-sample overlap scatter, leave-one-year-out error per region, per-block calibration factors with their shrinkage level, and uncertainty bands.
- **Fire Jukebox**: hear the sensor jump disappear, play a fire season as a melody, sweep the decades, crackle through a month. Every mode has a text description.
- **Downloads**: streaming hotspot CSV, monthly calendar CSV, chart PNGs, and a printable one-page report.
- **A regional anomaly leaderboard** on the home screen: which region is most unusual right now.
- **Accessibility**: light theme, colorblind-safe ramps, values printed in cells, full keyboard operation, a `role="grid"` calendar with per-cell labels, table fallbacks, `aria-live` announcements and reduced-motion support.

> **Data status.** Until a FIRMS key is added and real data is fetched, KELVIN runs on **SYNTHETIC DEMO DATA**. Every screen and every CSV says so. See [What is validated](#what-is-validated-and-what-is-not).

---

## Quick start (Windows 11, PowerShell)

Requires **Python 3.11+** and **Node.js 20+**.

```powershell
git clone https://github.com/akshitag001/Kelvin.git
cd Kelvin
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e .
python scripts/dev.py
```

Open **http://localhost:5173**. On the first run, `dev.py` generates the synthetic demo dataset (about 2 minutes) and installs the frontend packages.

If PowerShell blocks `Activate.ps1`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or skip activation and call `.\.venv\Scripts\python.exe` directly.

macOS and Linux are the same, except use `source .venv/bin/activate`.

### Single-process production mode

```powershell
python scripts/dev.py --prod     # builds the frontend, serves app + API on http://127.0.0.1:8000
```

---

## Real data from NASA FIRMS

### 1. Get a free MAP_KEY
Register at **https://firms.modaps.eosdis.nasa.gov/api/map_key/** (one form; the key arrives by email). Then:

```powershell
Copy-Item .env.example .env
notepad .env        # set FIRMS_MAP_KEY=your_key
```

### 2. Fetch the pilot regions (API path)

```powershell
python scripts/pilot_fetch.py                 # probe → fetch P0 regions → build → check
python scripts/pilot_fetch.py --priority 1    # add California, SE Australia, all India
```

The fetcher probes `data_availability` instead of hard-coding dates, uses SP (science-quality) data wherever it exists and NRT only after the last SP day, and runs 6 workers with adaptive back-off on the rate limit. It is **resumable**: re-run it after an interruption and finished chunks are skipped.

### 3. Bulk history via FIRMS Archive Download (fastest for 25 years)
The API is limited to 5-day windows, so for decades over big areas, use the archive tool:

1. Go to **https://firms.modaps.eosdis.nasa.gov/download/** and sign in with Earthdata (or use the email code).
2. Create a request: **Source** = MODIS C6.1, then repeat for VIIRS S-NPP, NOAA-20 and NOAA-21 · **Date range** = the full record · **Area** = a custom rectangle or country · **Format** = CSV.
3. When the emails arrive, download the zips into `data/raw/manual/` (or anywhere) and run:

```powershell
python -m kelvin import-archive              # or: python -m kelvin import-archive C:\path\to\downloads
```

The importer detects the sensor from the columns, the satellite from the `satellite` column or the file name (`SV-C2` = S-NPP, `J1V` = NOAA-20, `J2V` = NOAA-21) and SP vs NRT from the name. It then rebuilds and recalibrates.

### 4. Keep it current

```powershell
python -m kelvin refresh        # tops up the last 15 days of NRT data, rebuilds, recalibrates
```

---

## CLI reference

`python -m kelvin <command>` (or `kelvin <command>` after `pip install -e .`)

| Command | What it does |
|---|---|
| `demo-data` | Generate SYNTHETIC data with a known MODIS→VIIRS factor, then build and calibrate |
| `probe` | Check the key, list FIRMS data availability, sample the CSV columns → `docs/DATA_SOURCES_PROBE.json` |
| `fetch [--regions …] [--priority N] [--start YYYY-MM-DD]` | Download through the FIRMS area API (resumable) |
| `import-archive [folder]` | Import FIRMS Archive Download CSV or zip files |
| `build [--demo]` | Clean → 1 km grid → `cellday`/`cellmonth` aggregates → calibrate |
| `calibrate` | Re-estimate harmonization factors only |
| `refresh` | NRT top-up, rebuild, recalibrate |
| `check [--yearly-summary file.csv]` | Coverage and sanity checks, optionally against a FIRMS yearly summary |
| `serve [--port 8000]` | API and built frontend |

---

## Tests

```powershell
python -m pytest                        # 42 backend tests (~1 min; builds a temporary synthetic DB)
cd frontend; npm run typecheck; npm run lint; npm test; npm run build
```

Backend tests cover grid math, cleaning, confidence normalization, SP/NRT precedence, type filtering, AOI polygon and circle selection, **recovery of the planted VIIRS→MODIS factor and the Terra-only factor**, the step removal at 2012, the rule that MODIS and VIIRS are never added together, anomaly, percentile and robust-z math, month-to-date logic, trend wording, every API endpoint, and CSV headers and content. Frontend tests cover the calendar's grid semantics, keyboard navigation and table view, the AOI form validation, and URL state.

---

## How the harmonization works (short version)

1. **Common unit.** Snap every detection to a ~1 km equal-area cell (MODIS sinusoidal grid) and count **cell-days**. This absorbs most of the resolution and overpass-count differences.
2. **Calibrate in the overlap (2012–2021).** Fit `k = ΣMODIS / ΣVIIRS` per 1° block × season, with hierarchical shrinkage (block-season → block → 10° region → global) and a bootstrap 90% interval. Aqua and Suomi NPP are the like-for-like pair (both ~13:30 overpass). NOAA-20 and NOAA-21 are chained to SNPP.
3. **Terra-only months** (Nov 2000–Jul 2002) are scaled by a Terra→(Terra or Aqua) factor and flagged *estimated*.
4. **Assemble.** MODIS before 2022-01-01, `k × VIIRS` from then on. **Never** the sum.
5. **Validate.** Leave-one-year-out cross-validation per region (weighted error, MAPE, bias, R², Spearman), shown in the app.

The full method, with the reasoning behind each choice, is in **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)**.

---

## What is validated and what is not

| | Status |
|---|---|
| Harmonization math recovers known factors | ✅ Tested on synthetic data: seasonal k within 6%, Terra factor within 8% (`backend/tests/test_pipeline.py`) |
| Pipeline correctness (cleaning, grid, dedupe, aggregation, API) | ✅ 42 backend tests + 7 frontend tests |
| Calibration against **real** FIRMS data | ⏳ Pending: needs a MAP_KEY and a fetch. The k values and validation errors shown in demo mode describe synthetic data only. |
| Comparison with FIRMS country yearly summaries | ⏳ `kelvin check --yearly-summary` is implemented; run it after the real-data import |
| Regions loaded | Demo: Punjab–Haryana, Uttarakhand, Central Odisha, California, SE Australia (synthetic) |
| Last data refresh | Shown in the app footer and at `/api/status` |

Limitations (clouds, overpass timing, small fires below MODIS detection, static heat sources, NRT being provisional, MODIS orbit drift, and the fact that a hotspot is not burned area or a cause) are shown in the app's **Limitations** panel and in [docs/METHODOLOGY.md](docs/METHODOLOGY.md#limitations).

---

## Architecture

```
FIRMS API / Archive CSVs ─► ingest (clean, type filter, SP>NRT) ─► 1 km equal-area grid
      ─► DuckDB: detections (Parquet by year), cellday, cellmonth, blockmonth, cells, meta
      ─► calibrate: k per block×season (+bootstrap, LOYO-CV), Terra factor, satellite chain
      ─► FastAPI: /api/aoi/{summary,daily,hotspots,hotspots.csv,calendar.csv,briefing}, /api/leaderboard, …
      ─► React + Vite + TypeScript + Tailwind, Leaflet + leaflet-draw, D3 scales, Recharts, Web Audio
```

```
kelvin/
  backend/kelvin/   api/  ingest/  process/  harmonize/  analytics/  cli.py
  backend/tests/
  frontend/src/     components/  lib/
  config/           regions.yaml  settings.yaml
  scripts/          dev.py  pilot_fetch.py
  docs/             METHODOLOGY.md  DECISIONS.md  DATA_SOURCES.md  DEMO_SCRIPT.md  AI_USAGE.md
  data/             raw/ processed/ cache/   (gitignored)
```

## Deploying

Any host that runs a Python process can serve KELVIN: `python scripts/dev.py --prod`, or build once with `npm run build` and run `python -m kelvin serve --host 0.0.0.0 --port $PORT`. Ship `data/processed/kelvin.duckdb` (the aggregate tables) plus `data/processed/detections/` (Parquet, used for maps and CSV downloads). Raw downloads are not needed at runtime.

## Attribution

Data: **NASA FIRMS** (LANCE/EOSDIS), MODIS Collection 6.1 and VIIRS 375 m active fire detections. NASA does not endorse this project. Basemap © Esri (Light Gray Canvas), © OpenStreetMap contributors; imagery © Esri. Geocoding by Nominatim (OpenStreetMap).

Hotspots are satellite detections of heat. They are not confirmed fires.
