# Data sources

## NASA FIRMS

- API docs: https://firms.modaps.eosdis.nasa.gov/api/
- Archive download: https://firms.modaps.eosdis.nasa.gov/download/
- Product page: https://www.earthdata.nasa.gov/data/tools/firms
- MAP_KEY registration: https://firms.modaps.eosdis.nasa.gov/api/map_key/

### Sources used

| FIRMS source | Satellite | Pixel | Record starts |
|---|---|---|---|
| `MODIS_SP` / `MODIS_NRT` | Terra + Aqua (C6.1) | 1 km | Terra Nov 2000; Aqua Jul 2002 |
| `VIIRS_SNPP_SP` / `_NRT` | Suomi NPP | 375 m | 20 Jan 2012 |
| `VIIRS_NOAA20_SP` / `_NRT` | NOAA-20 (JPSS-1) | 375 m | 1 Apr 2018 |
| `VIIRS_NOAA21_SP` / `_NRT` | NOAA-21 (JPSS-2) | 375 m | 17 Jan 2024 |

**KELVIN never hard-codes coverage.** `python -m kelvin probe` queries `/api/data_availability/csv/{KEY}/ALL`, prints the live min/max date per source, samples column names, and writes `docs/DATA_SOURCES_PROBE.json`. The fetcher uses the same endpoint at run time, starting NRT the day after the last SP date for each satellite.

### Endpoints (as implemented in `backend/kelvin/ingest/fetch.py`)

| Purpose | URL |
|---|---|
| Area CSV | `/api/area/csv/{KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE}/{YYYY-MM-DD}`. DAY_RANGE is 1–5; the date is the first day of the window. |
| Availability | `/api/data_availability/csv/{KEY}/ALL` |
| Key usage | `/mapserver/mapkey_status/?MAP_KEY={KEY}` |

The rate limit is about 5,000 transactions per 10 minutes per key. The client runs 6 workers. On a limit message or HTTP 429, all workers pause together with increasing back-off. Server errors are retried with exponential back-off. Each chunk is written atomically (`.part` then rename), so re-runs skip completed chunks.

### Columns

- MODIS: `latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence (0–100), version, bright_t31, frp, daynight[, type]`
- VIIRS: `latitude, longitude, bright_ti4, scan, track, acq_date, acq_time, satellite, instrument, confidence (l/n/h), version, bright_ti5, frp, daynight[, type]`
- `type` (SP only): 0 vegetation fire, 1 active volcano, 2 other static land source, 3 offshore
- `acq_time`: HHMM UTC. NRT `version` strings end in `NRT` (e.g. `6.1NRT`, `2.0NRT`).

### Archive file names (auto-detected by `import-archive`)

| Pattern | Meaning |
|---|---|
| `fire_archive_M-C61_*.csv` | MODIS, SP |
| `fire_nrt_M-C61_*.csv` | MODIS, NRT |
| `fire_archive_SV-C2_*.csv` | VIIRS Suomi NPP, SP |
| `fire_archive_J1V-C2_*.csv` | VIIRS NOAA-20, SP |
| `fire_archive_J2V-C2_*.csv` | VIIRS NOAA-21, SP |

The sensor is always confirmed from the columns, never the name alone.

### Status of verification

**Probed live on 2026-11-14** (`docs/DATA_SOURCES_PROBE.json`). The key status endpoint, the availability endpoint and the area CSV endpoint all work as documented above, and the MODIS and VIIRS NRT column lists match exactly. Live coverage on that date:

| Source | Available |
|---|---|
| MODIS_SP | 2000-11-01 .. 2026-08-31 |
| MODIS_NRT | 2026-09-01 .. 2026-11-14 |
| VIIRS_SNPP_SP | 2012-01-20 .. 2026-07-31 |
| VIIRS_SNPP_NRT | 2026-08-01 .. 2026-11-02 |
| VIIRS_NOAA20_SP | 2018-04-01 .. 2026-07-31 |
| VIIRS_NOAA20_NRT | 2026-08-01 .. 2026-11-14 |
| VIIRS_NOAA21_SP | 2023-03-01 .. 2026-07-31 (earlier than the 2024-01-17 date in the original brief) |
| VIIRS_NOAA21_NRT | 2024-01-17 .. 2026-11-14 |

So the SP/NRT boundary is the end of July 2026 for VIIRS and the end of August 2026 for MODIS. Everything after that is provisional. Re-run `python -m kelvin probe` to refresh; trust the live API over this page.

## Other services

| Service | Use | Terms |
|---|---|---|
| CARTO Positron / OpenStreetMap tiles | Light basemap | © OpenStreetMap contributors, © CARTO |
| Esri World Imagery | Optional satellite layer | © Esri, Maxar, Earthstar Geographics |
| Nominatim | Place search, one request per submit | OSM Nominatim usage policy |
