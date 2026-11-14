# KELVIN methodology

Harmonization version **kelvin-h1.0**. All defaults live in `config/settings.yaml`.

The goal is a single monthly (and daily) series in **MODIS-equivalent hotspot cell-days**, from November 2000 to today, so the sensor that made a detection no longer affects the number.

## 1. Data and cleaning

Source: NASA FIRMS active-fire detections. MODIS Collection 6.1 (Terra, Aqua, 1 km) and VIIRS 375 m (Suomi NPP, NOAA-20, NOAA-21), each in **SP** (standard, science quality) and **NRT** (near-real-time) processing. See `docs/DATA_SOURCES.md`.

| Step | Rule | Why |
|---|---|---|
| Confidence | MODIS: low < 30, nominal 30–79, high ≥ 80. VIIRS: `l`/`n`/`h`. **Low is dropped by default**; the UI and API offer `all`, `nominal` (default) and `high`. | Low-confidence detections are dominated by false alarms (sun glint, hot bare soil). |
| Type | Where a `type` column exists (SP products), keep only `type = 0` (presumed vegetation fire). NRT rows have no type and are kept. | Removes volcanoes (1), gas flares and industry (2) and offshore sources (3). This matters around India's industrial clusters. |
| Duplicates | Identical (lat, lon, date, time, satellite) rows are collapsed. | Overlapping downloads. |
| SP vs NRT | NRT rows are dropped wherever SP rows exist for the same satellite, date and 10° tile. Remaining NRT rows are flagged **provisional**. | SP replaces NRT once processed. The tile key keeps an SP import for one area from deleting NRT data for another. |
| Date | The UTC `acq_date` is the calendar date. | It is what FIRMS reports. Local-date shifts affect at most the night overpasses at day boundaries. |

## 2. A common unit: the active cell-day

Each detection is assigned to a ~1 km **equal-area** cell on the MODIS sinusoidal projection:

```
x = R · lon_rad · cos(lat_rad),  y = R · lat_rad,  R = 6 371 007.181 m
cell_x = floor(x / 1000),  cell_y = floor(y / 1000)
```

A **cell-day** for a sensor family is a cell with at least one detection from that family on that day.

- Collapsing 375 m VIIRS pixels into 1 km cells removes most of the **resolution** difference: a fire producing 4–7 VIIRS pixels and 1 MODIS pixel becomes one cell either way.
- Collapsing every overpass of a day into one cell-day removes most of the **overpass count** difference: Terra and Aqua cross at about 10:30 and 13:30, SNPP at about 13:30, and NOAA-20 about 50 minutes behind SNPP. Adding satellites adds overpasses, not cell-days.

Equal area matters because the cell count is an area measure that is comparable at any latitude.

Raw **detections** and **FRP sums** are kept as alternative metrics and go through the same calibration.

## 3. Calibration: VIIRS → MODIS

**Reference pair.** Aqua MODIS and Suomi NPP VIIRS share the ~13:30 local overpass, so they see the same diurnal phase of burning. MODIS-any (Terra OR Aqua) is the target, because it defines the whole record. Suomi NPP is the VIIRS reference. NOAA-20 is chained to SNPP, and NOAA-21 to NOAA-20, by ratios of monthly sums over each pair's overlap. If SNPP data stops, the chain keeps the series continuous.

**Window.** Default **2012-02-01 to 2021-12-31**. Terra's and later Aqua's orbits have drifted from their nominal overpass times since about 2022 (end of station-keeping), which changes what MODIS sees. Calibrating on the drifted years would mix a sensor-geometry change into `k`.

**Estimator.** A robust **ratio of sums**, `k = Σ MODIS_any / Σ SNPP`, over months in the window. Block-months whose log ratio is more than 3 robust σ from the block median (and have ≥ 20 VIIRS cell-days) are trimmed first. Ratio of sums is the minimum-variance estimator for proportional data with Poisson-like noise. Theil–Sen through the origin gives very similar results on our tests and is noted as an alternative.

**Stratification.** `k` is estimated per **1° block** and **season** (DJF, MAM, JJA, SON), because MODIS sensitivity varies with fire size and type, which vary in space and season.

**Hierarchical shrinkage.** For each level, the weight on its own ratio is `w = N / (N + n0)`, where N = VIIRS cell-days behind the ratio and `n0 = 400`:

```
k_global
k_region (10° tile)  = w_t · ratio_tile        + (1 − w_t) · k_global
k_block              = w_b · ratio_block       + (1 − w_b) · k_region
k_block,season       = w_s · ratio_block,season + (1 − w_s) · k_block
```

The **level used** is the finest level whose weight is ≥ 0.5. It is stored per factor and shown in the Harmonization tab as a share of VIIRS evidence.

**Uncertainty.** A bootstrap over calibration **years** (300 resamples, multinomial weights, the whole hierarchy refitted each time) gives a 90% interval for every factor. Resampling years rather than months respects within-year autocorrelation. The interval is propagated to the monthly series as `[k_lo · VIIRS, k_hi · VIIRS]` and drawn as a shaded band.

**AOI factor.** For an area of interest, each block's own `k` is applied to that block's VIIRS counts, then summed. The reported AOI `k` is the VIIRS-weighted mean of the block factors.

## 4. Terra-only period

Aqua's first full month is August 2002, so November 2000 to July 2002 is Terra alone. A factor `f = Σ (Terra OR Aqua) / Σ Terra` is estimated per block and **calendar month** from 2003–2006, with the same shrinkage, and applied to Terra counts in those months. They are flagged **estimated** and hatched in the calendar.

## 5. Assembly

```
harmonized(t) = MODIS_any(t)          t <  switch date (default 2022-01-01)
              = k(block, season) · VIIRS_ref(t)   t ≥ switch date
```

MODIS and VIIRS are **never added**: in the overlap they see the same fires. The app offers three views: **Harmonized**, **MODIS native**, and **VIIRS native (unscaled)**. A grey "raw stitch" line (MODIS, then raw VIIRS from 2012) shows the artifact that harmonization removes.

## 6. Validation

**Leave-one-year-out cross-validation** inside the window. For each year y, refit the whole hierarchy without y, predict `k · VIIRS` for y's block-months, and compare with observed MODIS-any, aggregated to monthly series per region:

- weighted absolute percentage error (WAPE) = Σ|pred − obs| / Σ obs
- MAPE over months with ≥ 20 MODIS units (avoids blow-ups on near-zero months)
- bias = Σ pred / Σ obs − 1
- R² and Spearman rank correlation

These are shown per region in the app, along with the out-of-sample overlap scatter.

**Synthetic recovery test.** `kelvin demo-data` plants known detection probabilities per satellite and season, which gives an analytic `k` and Terra factor. `backend/tests/test_pipeline.py` requires the calibrated seasonal `k` to be within 6% of the planted value and the Terra factor within 8%. It also requires the 2013–2020 VIIRS-native/MODIS ratio to exceed 1.15 (the jump exists) while scaled VIIRS matches MODIS within 5% (the jump is removed).

## 7. Analytics

| Quantity | Definition |
|---|---|
| Baseline | Same calendar month in the baseline years: by default every complete year before the current one. The month's own year is always excluded. User-selectable via the `baseline` parameter. |
| Ratio | value / baseline median |
| Percentile | Mid-rank empirical CDF within the baseline |
| Robust z | (x − median) / (1.4826 · MAD) |
| Classes | Record high or low (outside the baseline range, n ≥ 5), Much above (> P90), Above (> P75), Normal (P25–P75), Below (< P25), Much below (< P10) |
| Month to date | Cumulative value for days 1..d of the current month vs the median cumulative value for days 1..d in each baseline year. **A partial month is never compared with full months.** Partial months are excluded from rankings. |
| Fire season | Smallest contiguous (wrapping) run of months holding ≥ 70% of mean annual activity |
| Trend | Theil–Sen slope and Mann–Kendall test (tie-corrected) on complete years. Wording says "tendency", not "trend in fires", and adds caveats. |
| Briefing | Deterministic templates, with no language model |

## 8. Fire Jukebox mappings

| Mode | Mapping |
|---|---|
| Hear the sensor jump | Whole monthly record, twice (raw stitch, then harmonized). Pitch = continuous log(count), so the leap is exact. |
| Fire season melody | 12 notes per year. Pitch = log(count) quantized to C-major pentatonic C3–C6. Louder and brighter (filter open) above the median, softer and darker below. |
| Decades sweep | One note per year, about 30 s in total. Partial years are scaled to 12 months. |
| Crackle | Daily view. Poisson clicks, rate ∝ day's count, over a low hum so silence is audible. |
| Keyboard | Optional tone per calendar cell on arrow-key moves, plus an `aria-live` announcement. |

All sound is synthesized with the Web Audio API. Nothing autoplays, the default volume is low, Stop always works, and every mode has a text description.

## Limitations

- **A hotspot is not a fire, a burned area, or a cause.** One fire can fill many cells for days; several fires can share a cell.
- **Clouds and smoke** hide fires. Persistently cloudy seasons are undercounted by both sensors, not necessarily equally.
- **Overpass timing and the diurnal cycle.** Polar orbiters sample each place a few times a day; short-lived fires between passes are missed. MODIS orbit drift after about 2021 changes MODIS sampling, which is why the calibration window ends in 2021.
- **Small fires below MODIS detection.** VIIRS sees fires MODIS cannot. Scaling corrects the average difference per block and season, not individual fires. Years dominated by tiny fires carry extra uncertainty.
- **Static heat sources** are removed only where SP data provides `type`. NRT data does not.
- **NRT is provisional** and is replaced by SP data months later.
- **Regional calibration.** Thinly sampled blocks fall back to broader averages. The level is reported.
- **Terra-only months are estimated.**
- **Synthetic demo data** describes nothing real. Real-data validation requires a FIRMS fetch (see the README).
