# Decisions log

Choices made during the build, with the reason for each. Newest last.

| # | Decision | Why |
|---|---|---|
| 1 | **DuckDB + Parquet**, single file, no extensions | Runs natively on Windows with no server. Fast enough for AOI summaries in 0.1–0.3 s on millions of cell-days. |
| 2 | Aggregates precomputed **per confidence tier** (`conf` 0/1/2 in `cellday`/`cellmonth`/`blockmonth`) | The confidence filter changes cell-day counts, so it cannot be applied after aggregation. Three tiers cost about 2× storage and keep every query a plain sum. |
| 3 | `blockmonth` table for calibration | Calibration needs per-block monthly sums; computing them once avoids scanning `cellmonth` 9× (3 metrics × 3 tiers). |
| 4 | **Ratio of sums** as the default estimator, with outlier-month trimming | Minimum-variance for proportional counts. Simple to explain to judges. Theil–Sen gave near-identical results on synthetic tests. |
| 5 | Shrinkage `w = N/(N + 400)` with a 10° tile as the "region" level | A transparent empirical-Bayes-style weight. 400 VIIRS cell-days ≈ one active season in a busy 1° block. Pre-defined 10° tiles avoid depending on which regions happen to be loaded. |
| 6 | Bootstrap over **years**, not months | Months within a year are correlated (same season, same weather regime). |
| 7 | Default switch date **2022-01-01**, calibration window **2012-02 to 2021-12** | Per the brief. MODIS orbit drift after 2021. Both are configurable in `config/settings.yaml`. |
| 8 | SP-over-NRT precedence keyed on (satellite, date, **10° tile**) | A pure (satellite, date) key would let a small SP archive import delete NRT data for the rest of the world on that day. |
| 9 | Current month compared with the **cumulative same days** of baseline years | Never compare a partial month with full months (per the brief). Partial months are also excluded from rankings and trends. |
| 10 | Synthetic demo data snaps fires to **1 km cell centres** with sub-cell jitter | Makes the planted `k` exact in cell-day units, so the recovery test checks the estimator, not grid-edge effects. Real data has no such snapping. |
| 11 | Calendar built as an **HTML grid of buttons** (D3 only for color scales), not an SVG | Native focus, `role="grid"` and keyboard semantics, and screen-reader labels. Text in every cell stays crisp. Recharts is used for line, area and bar charts. |
| 12 | **Leaflet + leaflet-draw** used directly, not `react-leaflet-draw` | The React wrapper is unmaintained. `leaflet-draw` is loaded after Leaflet sets the global `L`. Rectangle `showArea` is off to avoid a known 1.0.4 tooltip bug. |
| 13 | Light "orbital daylight" visual language | The brief requires a light theme only. The "space" feel comes from orbit motifs, an animated satellite hero, telemetry-style mono labels and glass panels on a pale stratosphere gradient. |
| 14 | Nominatim queried **only on submit** | Respects the Nominatim usage policy (no per-keystroke requests). |
| 15 | URL holds all state (`r`/`bbox`/`pt`/`geo`, metric, view, conf, base, tab, month) | Share links reproduce the exact view. Commas are left unescaped for readability. |
| 16 | Hotspot map: raw points up to 4,000, else a grid sized to the AOI | Keeps the canvas layer fast. The grid cell is about 1/120 of the AOI span. |
| 17 | CSV download streams Arrow record batches | Constant memory for large AOIs. The header comment block records query, source, filters, harmonization version and attribution. |
| 18 | Briefing is **template-based** | Deterministic and auditable, with no external LLM (per the brief). |
| 19 | One process in production (FastAPI serves `frontend/dist`) | Simplest deploy: any host that runs Python. |
| 20 | Tests build their own temporary DB via `KELVIN_DATA_DIR` | Tests never touch the user's real `data/` folder. |
