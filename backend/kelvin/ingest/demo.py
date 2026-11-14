"""Synthetic demo dataset (`kelvin demo-data`).

SYNTHETIC DEMO DATA. Nothing here is a real fire. The generator exists so the
whole pipeline, the harmonization tests and the UI can run before real FIRMS
downloads finish. The app watermarks every screen and every CSV in demo mode.

Model: each region has a pool of fire-prone points. Every day a Poisson number
of "true fires" occurs (seasonal curve x year factor x daily noise). Each
satellite then detects each fire independently with its own probability, which
gives a *known* MODIS-to-VIIRS factor that the tests must recover:

    k = P(Terra or Aqua detects) / P(SNPP detects)

The files are written in the raw FIRMS column layout, one per FIRMS source, so
they flow through exactly the same cleaning and build code as real data.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from kelvin import config, grid

SEED = 20261114
SAT_START = {
    "Terra": date(2000, 11, 1),
    "Aqua": date(2002, 7, 4),
    "SNPP": date(2012, 1, 20),
    "NOAA20": date(2018, 4, 1),
    "NOAA21": date(2024, 1, 17),
}
# Base detection probability of a fire, per satellite.
P_DETECT = {"Terra": 0.34, "Aqua": 0.44, "SNPP": 0.85, "NOAA20": 0.85, "NOAA21": 0.86}
LOW_CONF = {"MODIS": 0.08, "VIIRS": 0.06}  # share of detections flagged low confidence
# Seasonal modulation of MODIS sensitivity (DJF, MAM, JJA, SON): cooler, smaller
# fires in some seasons are easier to miss at 1 km.
SEASON_MOD = np.array([0.94, 1.06, 1.00, 0.97])
SP_LAG_DAYS = 95
LOCAL_HOURS = {"Terra": (10.5, 22.5), "Aqua": (13.5, 1.5), "SNPP": (13.5, 1.5),
               "NOAA20": (12.7, 0.7), "NOAA21": (13.1, 1.1)}
FIRMS_SAT_CODE = {"Terra": "Terra", "Aqua": "Aqua", "SNPP": "N", "NOAA20": "N20", "NOAA21": "N21"}


def season_of_month(month) -> np.ndarray:
    """0 = DJF, 1 = MAM, 2 = JJA, 3 = SON."""
    return (np.asarray(month) % 12) // 3


def _seasonal_curve(doy: np.ndarray, peaks: list[list[float]]) -> np.ndarray:
    m = doy / 365.25 * 12 + 0.5  # fractional month, 0.5 .. 12.5
    curve = np.full(doy.shape, 0.015)
    for center, width, amp in peaks:
        d = np.abs(m - center)
        d = np.minimum(d, 12 - d)
        curve += amp * np.exp(-0.5 * (d / width) ** 2)
    return curve


def planted_factors(region_mod: float) -> dict:
    """Analytic factors for the default (nominal + high confidence) filter."""
    out = {"k": {}, "terra_factor": {}}
    keep_m, keep_v = 1 - LOW_CONF["MODIS"], 1 - LOW_CONF["VIIRS"]
    for s in range(4):
        mod = region_mod * SEASON_MOD[s]
        pt = min(P_DETECT["Terra"] * mod, 0.95) * keep_m
        pa = min(P_DETECT["Aqua"] * mod, 0.95) * keep_m
        p_any = 1 - (1 - pt) * (1 - pa)
        out["k"][str(s)] = p_any / (P_DETECT["SNPP"] * keep_v)
        out["terra_factor"][str(s)] = p_any / pt
    return out


def _region_frames(rid: str, region: config.Region, rng: np.random.Generator, end: date) -> tuple[list[pd.DataFrame], dict]:
    p = region.demo or {}
    w, s, e, n = region.bbox
    start = SAT_START["Terra"]
    days = pd.date_range(start, end, freq="D")
    nd = len(days)

    # Pool of fire-prone points, clustered.
    n_pool, n_clusters = 6000, 28
    cx = rng.uniform(w + 0.2, e - 0.2, n_clusters)
    cy = rng.uniform(s + 0.2, n - 0.2, n_clusters)
    which = rng.integers(0, n_clusters, n_pool)
    spread = min(e - w, n - s) * 0.07
    plon = np.clip(cx[which] + rng.normal(0, spread, n_pool), w + 0.01, e - 0.01)
    plat = np.clip(cy[which] + rng.normal(0, spread, n_pool), s + 0.01, n - 0.01)
    # Snap to 1 km cell centres; pixel jitter below stays inside the cell, so the
    # planted factors are exact in cell-day units.
    plat, plon = grid.cell_center(grid.cell_id(plat, plon))
    weight = rng.lognormal(0, 0.8, n_pool)
    weight /= weight.sum()

    # Daily expected number of true fires.
    doy = days.dayofyear.to_numpy().astype(float)
    curve = _seasonal_curve(doy, p["peaks"])
    main_peak = max(p["peaks"], key=lambda pk: pk[2])[0]
    wraps = main_peak >= 11.5 or main_peak <= 1.5
    season_year = (days - pd.Timedelta(days=183)).year.to_numpy() if wraps else days.year.to_numpy()
    years = np.arange(season_year.min(), season_year.max() + 1)
    vol = float(p.get("volatility", 0.28))
    yfac = (1 + float(p.get("trend", 0))) ** (years - 2000) * rng.lognormal(0, vol, len(years))
    for y, mult in (p.get("spikes") or {}).items():
        yfac[years == int(y)] *= float(mult)
    lam = curve / curve[:365].sum() * float(p["annual"]) * yfac[season_year - years[0]]
    lam = lam * rng.gamma(5.0, 1 / 5.0, nd)
    n_fires = rng.poisson(lam)

    fire_day = np.repeat(np.arange(nd), n_fires)
    fire_pt = rng.choice(n_pool, size=fire_day.size, p=weight)

    # A few static heat sources (type 2 in SP products; untyped in NRT).
    n_static = 2
    st_lon = rng.uniform(w + 0.3, e - 0.3, n_static)
    st_lat = rng.uniform(s + 0.3, n - 0.3, n_static)
    st_lat, st_lon = grid.cell_center(grid.cell_id(st_lat, st_lon))

    region_mod = float(rng.uniform(0.9, 1.1))
    month = days.month.to_numpy()
    season = season_of_month(month)
    sp_end = end - timedelta(days=SP_LAG_DAYS)
    day_dates = days.to_numpy()
    lon_shift_h = (w + e) / 2 / 15.0

    frames: list[pd.DataFrame] = []
    for sat, sat_start in SAT_START.items():
        sensor = config.SENSOR_OF[sat]
        first = (sat_start - start).days
        pdet = np.full(fire_day.size, P_DETECT[sat])
        if sensor == "MODIS":
            pdet = np.minimum(pdet * region_mod * SEASON_MOD[season[fire_day]], 0.95)
        hit = (rng.random(fire_day.size) < pdet) & (fire_day >= first)
        d_idx, pt_idx = fire_day[hit], fire_pt[hit]
        typ = np.zeros(d_idx.size, dtype="int8")
        lat0, lon0 = plat[pt_idx], plon[pt_idx]

        # static sources: seen on about a quarter of days
        st_days = np.arange(max(first, 0), nd)
        st_mask = rng.random((n_static, st_days.size)) < 0.25
        si, sd = np.nonzero(st_mask)
        d_idx = np.concatenate([d_idx, st_days[sd]])
        lat0 = np.concatenate([lat0, st_lat[si]])
        lon0 = np.concatenate([lon0, st_lon[si]])
        typ = np.concatenate([typ, np.full(si.size, 2, dtype="int8")])

        # confidence is drawn per detection event, shared by its pixels
        n_ev = d_idx.size
        u = rng.random(n_ev)
        if sensor == "MODIS":
            conf_ev = np.where(u < LOW_CONF["MODIS"], rng.integers(5, 30, n_ev),
                               np.where(u < 0.68, rng.integers(30, 80, n_ev), rng.integers(80, 101, n_ev)))
            reps = 1 + (rng.random(n_ev) < 0.15)
            jitter, frp_med = 0.003, 24.0
        else:
            conf_ev = np.where(u < LOW_CONF["VIIRS"], "l", np.where(u < 0.9, "n", "h"))
            reps = np.minimum(rng.geometric(0.55, n_ev), 4)
            jitter, frp_med = 0.003, 5.5
        idx = np.repeat(np.arange(n_ev), reps)
        m = idx.size
        is_day = rng.random(n_ev) < 0.82
        hours = np.where(is_day, LOCAL_HOURS[sat][0], LOCAL_HOURS[sat][1]) - lon_shift_h + rng.normal(0, 0.4, n_ev)
        hours = np.mod(hours, 24)
        hhmm = (np.floor(hours).astype(int) * 100 + np.floor((hours % 1) * 60).astype(int))[idx]
        dts = day_dates[d_idx][idx]
        is_sp = dts <= np.datetime64(sp_end)
        frp = np.round(rng.lognormal(np.log(frp_med), 0.9, m), 1)
        bright = np.round(rng.normal(330, 14, m), 1)
        df = pd.DataFrame({
            "latitude": np.round(lat0[idx] + rng.uniform(-jitter, jitter, m), 5),
            "longitude": np.round(lon0[idx] + rng.uniform(-jitter, jitter, m), 5),
            ("brightness" if sensor == "MODIS" else "bright_ti4"): bright,
            "scan": 1.0 if sensor == "MODIS" else 0.39,
            "track": 1.0 if sensor == "MODIS" else 0.36,
            "acq_date": pd.to_datetime(dts).strftime("%Y-%m-%d"),
            "acq_time": hhmm,
            "satellite": FIRMS_SAT_CODE[sat],
            "instrument": sensor,
            "confidence": conf_ev[idx],
            "version": np.where(is_sp, "6.1" if sensor == "MODIS" else "2", "6.1NRT" if sensor == "MODIS" else "2.0NRT"),
            ("bright_t31" if sensor == "MODIS" else "bright_ti5"): np.round(bright - rng.uniform(20, 40, m), 1),
            "frp": frp,
            "daynight": np.where(is_day[idx], "D", "N"),
            "type": typ[idx],
            "_sat": sat,
            "_sp": is_sp,
        })
        frames.append(df)
    return frames, planted_factors(region_mod)


def generate(out_dir: Path | None = None, *, end: date | None = None, region_ids: list[str] | None = None,
             seed: int = SEED) -> dict:
    """Write synthetic raw files to data/raw/demo/ and return a summary."""
    out_dir = out_dir or (config.raw_dir() / "demo")
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.parquet"):
        old.unlink()
    end = end or date.today()
    rng = np.random.default_rng(seed)
    all_frames: list[pd.DataFrame] = []
    planted: dict = {}
    used = []
    for rid, region in config.regions().items():
        if region.demo is None or (region_ids and rid not in region_ids):
            continue
        frames, pf = _region_frames(rid, region, rng, end)
        all_frames.extend(frames)
        planted[rid] = pf
        used.append(rid)
    big = pd.concat(all_frames, ignore_index=True)
    rows = 0
    for sat in config.SATELLITES:
        for is_sp in (True, False):
            part = big[(big["_sat"] == sat) & (big["_sp"] == is_sp)]
            if part.empty:
                continue
            sensor = config.SENSOR_OF[sat]
            source = ("MODIS" if sensor == "MODIS" else f"VIIRS_{sat}") + ("_SP" if is_sp else "_NRT")
            part = part.drop(columns=["_sat", "_sp"]).dropna(axis=1, how="all")
            if not is_sp:
                part = part.drop(columns=["type"])  # NRT products carry no type column
            path = out_dir / f"{source}.parquet"
            if path.exists():  # MODIS: Terra and Aqua share one source file
                part = pd.concat([pd.read_parquet(path), part], ignore_index=True)
            part.to_parquet(path, index=False)
    rows = sum(len(pd.read_parquet(f, columns=["frp"])) for f in out_dir.glob("*.parquet"))
    summary = {
        "synthetic": True,
        "note": "SYNTHETIC DEMO DATA. Not real fire detections.",
        "seed": seed,
        "end_date": end.isoformat(),
        "sp_end_date": (end - timedelta(days=SP_LAG_DAYS)).isoformat(),
        "regions": used,
        "rows": int(rows),
        "planted": planted,
    }
    (out_dir / "planted.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary
