"""Apply the calibration to per-block series and assemble the harmonized series.

    harmonized(t) = MODIS_any(t)                    before the switch date
                  = k(block, season) * VIIRS_ref(t)  from the switch date on

MODIS and VIIRS are never added together. Before Aqua's first full month the
MODIS value is Terra * terra_factor(block, calendar month) and flagged estimated.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache

import numpy as np
import pandas as pd

from kelvin import config, db
from kelvin.harmonize.calibrate import LEVELS, season_of_month


@dataclass
class Factors:
    metric: str
    conf: int
    k: pd.DataFrame            # index: block_id * 4 + season -> k, k_lo, k_hi, level
    terra: pd.Series           # index: block_id * 12 + (month - 1) -> f
    global_k: float | None
    global_k_lo: float | None
    global_k_hi: float | None
    terra_global: float | None
    chain: dict
    coverage: dict
    switch: date
    aqua_ym: int
    data_end: date
    calibration_window: tuple[str, str] = ("", "")
    extra: dict = field(default_factory=dict)


def _ym(d: date) -> int:
    return d.year * 100 + d.month


def _first_full_month(d: date) -> int:
    if d.day == 1:
        return _ym(d)
    return (d.year + 1) * 100 + 1 if d.month == 12 else d.year * 100 + d.month + 1


@lru_cache(maxsize=32)
def _load(metric: str, conf: int, stamp: float) -> Factors:
    cur = db.connect()
    meta = db.meta()
    cfg = config.settings()["harmonization"]
    cal = meta.get("calibration", {})
    conf_name = {v: k for k, v in config.CONF_LEVELS.items()}[conf]
    summ = cal.get("factors", {}).get(f"{metric}:{conf_name}", {})
    k = cur.execute("SELECT block_id, season, k, k_lo, k_hi, level FROM calibration WHERE metric = ? AND conf = ?", [metric, conf]).df()
    k.index = k["block_id"].to_numpy(dtype="int64") * 4 + k["season"].to_numpy(dtype="int64")
    t = cur.execute("SELECT block_id, month, f FROM terra_factor WHERE metric = ? AND conf = ?", [metric, conf]).df()
    terra = pd.Series(t["f"].to_numpy(), index=t["block_id"].to_numpy(dtype="int64") * 12 + t["month"].to_numpy(dtype="int64") - 1)
    aqua = cfg["aqua_first_full_month"]
    return Factors(
        metric=metric, conf=conf, k=k[["k", "k_lo", "k_hi", "level"]], terra=terra,
        global_k=summ.get("global_k"), global_k_lo=summ.get("global_k_lo"), global_k_hi=summ.get("global_k_hi"),
        terra_global=summ.get("terra_global"), chain=summ.get("chain", {}), coverage=meta.get("coverage", {}),
        switch=date.fromisoformat(cal.get("switch_date", cfg["switch_date"])),
        aqua_ym=int(aqua[:4]) * 100 + int(aqua[5:7]), data_end=date.fromisoformat(meta["data_end"]),
        calibration_window=(cal.get("calibration_start", cfg["calibration_start"]), cal.get("calibration_end", cfg["calibration_end"])),
    )


def factors(metric: str, conf: int) -> Factors:
    return _load(metric, conf, config.db_path().stat().st_mtime)


def harmonize(df: pd.DataFrame, fx: Factors) -> pd.DataFrame:
    """Harmonize per-block rows and sum over blocks.

    df columns: block_id, M, T, V, V20, V21 and either `ym` (monthly) or `date` (daily).
    Returns one row per period with: harmonized, lo, hi, modis, viirs, viirs_scaled,
    stitch, k (effective), estimated, source, and level weights.
    """
    daily = "date" in df.columns
    key = "date" if daily else "ym"
    if df.empty:
        return pd.DataFrame(columns=[key, "harmonized", "lo", "hi", "modis", "viirs", "viirs_scaled", "stitch",
                                     "k", "estimated", "source"] + [f"w_{l}" for l in LEVELS])
    df = df.copy()
    if daily:
        dts = pd.to_datetime(df["date"])
        ym = (dts.dt.year * 100 + dts.dt.month).to_numpy()
        day = dts.dt.date
    else:
        ym = df["ym"].to_numpy()
    month = ym % 100
    block = df["block_id"].to_numpy(dtype="int64")

    # --- VIIRS reference: SNPP, else NOAA-20 and NOAA-21 chained onto SNPP ----
    def covered(sat: str) -> np.ndarray:
        cov = fx.coverage.get(sat)
        if not cov:
            return np.zeros(len(df), dtype=bool)
        a, b = date.fromisoformat(cov["start"]), date.fromisoformat(cov["end"])
        if daily:
            return ((day >= a) & (day <= b)).to_numpy()
        return (ym >= _first_full_month(a)) & (ym <= _ym(b))

    c20 = fx.chain.get("NOAA20", {}).get("factor", 1.0)
    c21 = fx.chain.get("NOAA21", {}).get("factor", 1.0)
    has_s, has_20, has_21 = covered("SNPP"), covered("NOAA20"), covered("NOAA21")
    vref = np.where(has_s, df["V"], np.where(has_20, df["V20"] * c20, np.where(has_21, df["V21"] * c21, 0.0)))
    has_v = has_s | has_20 | has_21

    # --- k per block and season, falling back to the global factor ----------
    gk = fx.global_k
    kk = fx.k.reindex(block * 4 + season_of_month(month))
    k = kk["k"].to_numpy(dtype="float64")
    k_lo = kk["k_lo"].to_numpy(dtype="float64")
    k_hi = kk["k_hi"].to_numpy(dtype="float64")
    level = kk["level"].to_numpy(dtype=object)
    miss = np.isnan(k)
    if gk is not None:
        k[miss], k_lo[miss], k_hi[miss] = gk, fx.global_k_lo or gk, fx.global_k_hi or gk
    level[miss] = "global"
    calibrated = gk is not None

    # --- MODIS, with the Terra-only correction ------------------------------
    terra_only = ym < fx.aqua_ym
    f = fx.terra.reindex(block * 12 + month - 1).to_numpy(dtype="float64")
    f = np.where(np.isnan(f), fx.terra_global if fx.terra_global else 1.0, f)
    m_native = df["M"].to_numpy(dtype="float64")
    m_adj = np.where(terra_only, df["T"].to_numpy(dtype="float64") * f, m_native)

    if daily:
        after = (day >= fx.switch).to_numpy()
    else:
        after = ym >= _ym(fx.switch)
    use_v = after & has_v & calibrated
    scaled = np.where(calibrated, k * vref, np.nan)
    df["harmonized"] = np.where(use_v, scaled, m_adj)
    df["lo"] = np.where(use_v, k_lo * vref, m_adj)
    df["hi"] = np.where(use_v, k_hi * vref, m_adj)
    df["modis"] = m_native
    df["viirs"] = np.where(has_v, vref, np.nan)
    df["viirs_scaled"] = np.where(has_v, scaled, np.nan)
    df["stitch"] = np.where(after & has_v, vref, m_native)
    df["estimated"] = terra_only & (df["T"].to_numpy() > 0)
    df["use_v"] = use_v
    df["_kv"] = np.where(has_v, k * vref, 0.0)
    df["_v"] = np.where(has_v, vref, 0.0)
    for lv in LEVELS:
        df[f"w_{lv}"] = np.where(level == lv, df["_v"], 0.0)

    g = df.groupby(key, sort=True)
    out = g[["harmonized", "lo", "hi", "modis", "stitch", "_kv", "_v"] + [f"w_{lv}" for lv in LEVELS]].sum()
    out["viirs"] = g["viirs"].sum(min_count=1)
    out["viirs_scaled"] = g["viirs_scaled"].sum(min_count=1)
    out["estimated"] = g["estimated"].any()
    out["source"] = np.where(g["use_v"].any(), "VIIRS", "MODIS")
    out["k"] = np.where(out["_v"] > 0, out["_kv"] / out["_v"].where(out["_v"] > 0, 1.0), np.nan)
    return out.drop(columns=["_kv", "_v"]).reset_index()
