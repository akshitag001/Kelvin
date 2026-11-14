"""AOI analytics: monthly series, calendar, anomalies, seasonality, trend, rankings, daily view."""
from __future__ import annotations

import calendar
import math
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from kelvin import config, db
from kelvin.analytics import aoi as aoimod
from kelvin.analytics import stats
from kelvin.analytics.aoi import Aoi
from kelvin.harmonize.apply import Factors, _first_full_month, _ym, factors, harmonize
from kelvin.harmonize.calibrate import LEVELS

METRIC_LABEL = {
    "cells": ("hotspot cell-days", "MODIS-equivalent hotspot cell-days (1 km cells with a detection, per day)"),
    "detections": ("detections", "MODIS-equivalent fire-pixel detections"),
    "frp": ("MW", "MODIS-equivalent summed fire radiative power, megawatts"),
}
VIEW_COL = {"harmonized": "harmonized", "modis": "modis", "viirs": "viirs"}
_cache = aoimod.LRU(config.settings()["api"]["cache_size"])


@dataclass(frozen=True)
class Params:
    start: date | None = None
    end: date | None = None
    metric: str = "cells"
    view: str = "harmonized"
    confidence: str = "nominal"
    baseline: tuple[int, int] | None = None

    def __post_init__(self):
        if self.metric not in METRIC_LABEL:
            raise aoimod.AoiError(f"metric must be one of {sorted(METRIC_LABEL)}")
        if self.view not in VIEW_COL:
            raise aoimod.AoiError(f"view must be one of {sorted(VIEW_COL)}")
        if self.confidence not in config.CONF_LEVELS:
            raise aoimod.AoiError(f"confidence must be one of {sorted(config.CONF_LEVELS)}")
        if self.start and self.end and self.start > self.end:
            raise aoimod.AoiError("start must not be after end")

    @property
    def conf(self) -> int:
        return config.CONF_LEVELS[self.confidence]

    def key(self) -> str:
        return f"{self.start}:{self.end}:{self.metric}:{self.view}:{self.confidence}:{self.baseline}"


def jsonable(o: Any) -> Any:
    """Convert numpy / pandas values to plain JSON types; NaN becomes null."""
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, (np.bool_, bool)):
        return bool(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if math.isnan(f) or math.isinf(f) else round(f, 3)
    if isinstance(o, (date, pd.Timestamp)):
        return str(o)[:10]
    if o is pd.NaT or o is pd.NA:
        return None
    return o


def _coverage(fx: Factors) -> dict:
    cov = fx.coverage
    modis = [cov[s] for s in ("Terra", "Aqua") if s in cov]
    viirs = [cov[s] for s in ("SNPP", "NOAA20", "NOAA21") if s in cov]
    out: dict[str, Any] = {"modis": None, "viirs": None, "nrt_ym": None}
    if modis:
        out["modis"] = (_ym(min(date.fromisoformat(c["start"]) for c in modis)), _ym(max(date.fromisoformat(c["end"]) for c in modis)))
        out["modis_dates"] = (min(date.fromisoformat(c["start"]) for c in modis), max(date.fromisoformat(c["end"]) for c in modis))
    if viirs:
        out["viirs"] = (min(_first_full_month(date.fromisoformat(c["start"])) for c in viirs), _ym(max(date.fromisoformat(c["end"]) for c in viirs)))
        out["viirs_dates"] = (min(date.fromisoformat(c["start"]) for c in viirs), max(date.fromisoformat(c["end"]) for c in viirs))
    nrt = [date.fromisoformat(c["nrt_start"]) for c in cov.values() if c.get("nrt_start")]
    if nrt:
        out["nrt_ym"] = _ym(min(nrt))
        out["nrt_date"] = min(nrt)
    return out


def _month_range(a: date, b: date) -> list[int]:
    out, y, m = [], a.year, a.month
    while (y, m) <= (b.year, b.month):
        out.append(y * 100 + m)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def monthly_frame(aoi: Aoi, p: Params) -> pd.DataFrame:
    """Every month of the record for the AOI, zero-filled, with flags and the primary `value`."""
    def run() -> pd.DataFrame:
        fx = factors(p.metric, p.conf)
        h = harmonize(aoimod.monthly_blocks(aoi, p.metric, p.conf), fx)
        meta = db.meta()
        d0, d1 = date.fromisoformat(meta["data_start"]), fx.data_end
        cov = _coverage(fx)
        df = pd.DataFrame({"ym": _month_range(d0, d1)}).merge(h, how="left", on="ym")
        for c in df.columns:
            if c not in ("ym", "estimated", "source"):
                df[c] = pd.to_numeric(df[c], errors="coerce").astype("float64")
        df["estimated"] = df["estimated"].astype("boolean").fillna(False).astype(bool)
        ym = df["ym"].to_numpy()
        in_modis = (ym >= cov["modis"][0]) & (ym <= cov["modis"][1]) if cov["modis"] else np.zeros(len(df), bool)
        in_viirs = (ym >= cov["viirs"][0]) & (ym <= cov["viirs"][1]) if cov["viirs"] else np.zeros(len(df), bool)
        calibrated = fx.global_k is not None
        from_viirs = (ym >= _ym(fx.switch)) & in_viirs & calibrated
        for c in ("harmonized", "lo", "hi", "stitch"):
            df[c] = df[c].fillna(0.0).where(from_viirs | in_modis)
        df["modis"] = df["modis"].fillna(0.0).where(in_modis)
        df["viirs"] = df["viirs"].fillna(0.0).where(in_viirs)
        df["viirs_scaled"] = df["viirs_scaled"].fillna(0.0).where(in_viirs & calibrated)
        df["source"] = np.where(from_viirs, "VIIRS", "MODIS")
        for lv in LEVELS:
            df[f"w_{lv}"] = df[f"w_{lv}"].fillna(0.0)
        df["year"], df["month"] = ym // 100, ym % 100
        df["provisional"] = (ym >= cov["nrt_ym"]) if cov["nrt_ym"] else False
        last_day = calendar.monthrange(d1.year, d1.month)[1]
        df["partial"] = (ym == _ym(d1)) & (d1.day < last_day)
        df["value"] = df[VIEW_COL[p.view]]
        return df

    return _cache.get_or_set(f"{aoimod.stamp()}:mf:{aoi.key}:{p.metric}:{p.view}:{p.confidence}", run)


def daily_frame(aoi: Aoi, p: Params, month: int) -> pd.DataFrame:
    """Harmonized daily values for one calendar month across all years (only days with detections)."""
    def run() -> pd.DataFrame:
        fx = factors(p.metric, p.conf)
        h = harmonize(aoimod.daily_blocks(aoi, p.metric, p.conf, month), fx)
        h["date"] = pd.to_datetime(h["date"])
        h["value"] = h[VIEW_COL[p.view]]
        return h

    return _cache.get_or_set(f"{aoimod.stamp()}:df:{aoi.key}:{p.metric}:{p.view}:{p.confidence}:{month}", run)


def _view_range(fx: Factors, view: str) -> tuple[date, date]:
    cov = _coverage(fx)
    start = date.fromisoformat(db.meta()["data_start"])
    if view == "modis" and cov.get("modis_dates"):
        return cov["modis_dates"]
    if view == "viirs" and cov.get("viirs_dates"):
        return cov["viirs_dates"]
    return start, fx.data_end


def _daily_matrix(aoi: Aoi, p: Params, month: int) -> tuple[pd.DataFrame, Factors]:
    """Rows = years, columns = day of month (1..31); NaN where the day is outside the record."""
    fx = factors(p.metric, p.conf)
    dd = daily_frame(aoi, p, month)
    lo, hi = _view_range(fx, p.view)
    years = [y for y in range(lo.year, hi.year + 1) if lo <= date(y, month, calendar.monthrange(y, month)[1]) and date(y, month, 1) <= hi]
    mat = pd.DataFrame(np.nan, index=years, columns=range(1, 32))
    for y in years:
        nd = calendar.monthrange(y, month)[1]
        for d in range(1, nd + 1):
            if lo <= date(y, month, d) <= hi:
                mat.at[y, d] = 0.0
    if not dd.empty:
        sub = dd.dropna(subset=["value"])
        for y, d, v in zip(sub["date"].dt.year, sub["date"].dt.day, sub["value"]):
            if y in mat.index and not math.isnan(mat.at[y, d]):
                mat.at[y, d] = v
    return mat, fx


def _baseline_years(p: Params, mf: pd.DataFrame, current_year: int) -> tuple[int, int]:
    valid = mf.dropna(subset=["value"])
    first = int(valid["year"].min()) if not valid.empty else current_year
    b0, b1 = first, current_year - 1
    if p.baseline:
        b0, b1 = max(first, p.baseline[0]), min(current_year, p.baseline[1])
    if b1 < b0:
        b0, b1 = first, max(first, current_year - 1)
    return b0, b1


def current_standing(aoi: Aoi, p: Params, b0: int, b1: int) -> dict:
    """Month to date vs the same days of the month in the baseline years."""
    fx = factors(p.metric, p.conf)
    d1 = _view_range(fx, p.view)[1]
    mat, _ = _daily_matrix(aoi, p, d1.month)
    day = d1.day
    last = calendar.monthrange(d1.year, d1.month)[1]
    cum = mat.loc[:, 1:day].sum(axis=1, min_count=day)  # only years with all those days in the record
    cur = float(cum.get(d1.year, np.nan))
    ref = cum[(cum.index >= b0) & (cum.index <= b1) & (cum.index != d1.year)].dropna()
    a = stats.anomaly(cur, ref.to_numpy())
    cov = _coverage(fx)
    provisional = bool(cov.get("nrt_date") and cov["nrt_date"] <= d1)
    full = day == last
    period = f"{stats.MONTHS[d1.month - 1]} {d1.year}" + ("" if full else f" so far (days 1-{day})")
    unit = METRIC_LABEL[p.metric][0]
    if a["cls"] == "no_baseline":
        headline = f"{period}: {cur:,.0f} {unit}. Not enough baseline years for a comparison."
    elif a["ratio"] is None:
        headline = (f"{period}: {cur:,.0f} {unit}. The historical median for these days is zero, "
                    f"so any activity is unusual ({stats.CLASS_LABELS[a['cls']].lower()}).")
    else:
        headline = (f"{period}: {a['ratio']:.1f}x the historical median "
                    f"({_ordinal(a['percentile'])} percentile), {stats.CLASS_LABELS[a['cls']].lower()}.")
    return {
        "ym": f"{d1.year}-{d1.month:02d}", "year": d1.year, "month": d1.month, "as_of": d1, "days": day,
        "full_month": full, "value": cur, "provisional": provisional, "headline": headline,
        "label": stats.CLASS_LABELS[a["cls"]], "baseline_years": [b0, b1], **a,
    }


def _ordinal(x: float | None) -> str:
    if x is None:
        return "n/a"
    n = int(round(x))
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def summarize(aoi: Aoi, p: Params) -> dict:
    return _cache.get_or_set(f"{aoimod.stamp()}:sum:{aoi.key}:{p.key()}", lambda: _summarize(aoi, p))


def _summarize(aoi: Aoi, p: Params) -> dict:
    meta = db.meta()
    fx = factors(p.metric, p.conf)
    mf = monthly_frame(aoi, p).copy()
    cells = aoimod.select_cells(aoi)
    d1 = fx.data_end
    b0, b1 = _baseline_years(p, mf, d1.year)
    warnings: list[dict] = []

    # ---- per-month anomaly against the same calendar month in the baseline years
    usable = mf["value"].notna() & ~mf["partial"]
    by_month = {m: mf[usable & (mf["month"] == m) & mf["year"].between(b0, b1)] for m in range(1, 13)}
    rows = []
    for r in mf.itertuples(index=False):
        ref = by_month[r.month]
        a = stats.anomaly(r.value, ref.loc[ref["year"] != r.year, "value"].to_numpy()) if not pd.isna(r.value) else None
        flags = [f for f, on in (("estimated", r.estimated and p.view != "viirs"), ("provisional", r.provisional), ("partial", r.partial)) if on]
        rows.append({
            "ym": f"{r.year}-{r.month:02d}", "year": r.year, "month": r.month,
            "value": r.value, "harmonized": r.harmonized, "lo": r.lo, "hi": r.hi,
            "modis": r.modis, "viirs": r.viirs, "viirs_scaled": r.viirs_scaled, "stitch": r.stitch,
            "source": r.source, "flags": flags,
            "median": a and a["median"], "ratio": a and a["ratio"], "percentile": a and a["percentile"],
            "z": a and a["z"], "cls": a["cls"] if a else None,
        })
    start_ym = _ym(p.start) if p.start else 0
    end_ym = _ym(p.end) if p.end else 999999
    shown = [r for r in rows if start_ym <= r["year"] * 100 + r["month"] <= end_ym]

    # ---- seasonality (baseline years)
    by_cal = []
    for m in range(1, 13):
        env = stats.envelope(by_month[m]["value"].to_numpy())
        by_cal.append({"month": m, **(env or {})})
    means = [b.get("mean", 0.0) or 0.0 for b in by_cal]
    medians = [b.get("median", 0.0) or 0.0 for b in by_cal]
    season = stats.fire_season(means)
    peak_month = int(np.argmax(medians)) + 1 if max(medians) > 0 else (int(np.argmax(means)) + 1 if max(means) > 0 else None)
    cur_year = mf[mf["year"] == d1.year].set_index("month")["value"]
    prev_year = mf[mf["year"] == d1.year - 1].set_index("month")["value"]
    seasonality = {
        "by_month": by_cal, "peak_month": peak_month, "season": season,
        "current_year": d1.year,
        "current": [cur_year.get(m) for m in range(1, 13)],
        "previous": [prev_year.get(m) for m in range(1, 13)],
    }

    # ---- annual totals, trend, rankings (within the selected date range)
    sm = pd.DataFrame(shown)
    annual, top_months, top_years = [], [], []
    tr = stats.trend([], [])
    if not sm.empty:
        sm["partial"] = sm["flags"].apply(lambda f: "partial" in f)
        g = sm.groupby("year")
        for y, grp in g:
            vals = grp["value"].dropna()
            complete = len(vals) == 12 and not grp["partial"].any()
            annual.append({"year": int(y), "total": float(vals.sum()) if len(vals) else None, "months": int(len(vals)),
                           "complete": bool(complete), "estimated": bool(grp["flags"].apply(lambda f: "estimated" in f).any())})
        comp = [a for a in annual if a["complete"]]
        tr = stats.trend([a["year"] for a in comp], [a["total"] for a in comp])
        ranked = sm[sm["value"].notna() & ~sm["partial"]].sort_values("value", ascending=False).head(10)
        top_months = [{"rank": i + 1, "ym": r.ym, "year": int(r.year), "month": int(r.month), "value": r.value,
                       "ratio": r.ratio, "cls": r.cls} for i, r in enumerate(ranked.itertuples(index=False))]
        top_years = [{"rank": i + 1, **a} for i, a in enumerate(sorted(comp, key=lambda a: -a["total"])[:10])]
    peak = top_months[0] if top_months else None

    # ---- harmonization summary for this AOI
    v = mf[mf["viirs"].notna() & (mf["viirs"] > 0)]
    k_eff = float((v["k"] * v["viirs"]).sum() / v["viirs"].sum()) if not v.empty and fx.global_k is not None else None
    post = mf[mf["source"] == "VIIRS"]
    tot = float(post["harmonized"].sum())
    band = (float(post["lo"].sum() / tot), float(post["hi"].sum() / tot)) if tot > 0 else (1.0, 1.0)
    wsum = mf[[f"w_{lv}" for lv in LEVELS]].sum()
    wtot = float(wsum.sum())
    levels = {lv: (float(wsum[f"w_{lv}"] / wtot) if wtot > 0 else 0.0) for lv in LEVELS}
    cv_region = _region_for(aoi)
    cur = db.connect()
    cvrow = cur.execute("SELECT mape, wmape, bias, r2, spearman, n_months FROM cv WHERE metric = ? AND conf = ? AND region = ?",
                        [p.metric, p.conf, cv_region]).fetchone()
    harmon = {
        "version": meta.get("harmonization_version"),
        "k": k_eff, "k_lo": k_eff * band[0] if k_eff else None, "k_hi": k_eff * band[1] if k_eff else None,
        "global_k": fx.global_k, "levels": levels, "dominant_level": max(levels, key=levels.get) if wtot > 0 else "global",
        "switch_date": fx.switch, "calibration_window": list(fx.calibration_window),
        "terra_only_until": f"{fx.aqua_ym // 100}-{fx.aqua_ym % 100:02d}", "chain": fx.chain,
        "cv_region": cv_region,
        "cv": dict(zip(["mape", "wmape", "bias", "r2", "spearman", "n_months"], cvrow)) if cvrow else None,
    }

    # ---- warnings
    area = aoimod.area_km2(aoi.geom)
    frac = aoimod.coverage_fraction(aoi.geom, meta.get("coverage_boxes", []))
    names = ", ".join(b["name"] for b in meta.get("coverage_boxes", [])) or "none"
    if frac <= 0.001:
        warnings.append({"code": "outside_coverage", "level": "error",
                         "text": f"This area is outside the loaded data coverage, so there is nothing to show. Loaded: {names}."})
    elif frac < 0.98:
        warnings.append({"code": "partial_coverage", "level": "warn",
                         "text": f"Only {frac * 100:.0f}% of this area is inside the loaded data coverage. Counts describe the covered part only. Loaded: {names}."})
    if area < 100:
        warnings.append({"code": "tiny_aoi", "level": "warn",
                         "text": f"This area is small ({area:,.0f} km2). Monthly counts will be low and statistics noisy."})
    if frac > 0.001 and len(cells) == 0:
        warnings.append({"code": "no_detections", "level": "info", "text": "No hotspots were detected in this area in the loaded record."})
    if fx.global_k is None:
        warnings.append({"code": "no_calibration", "level": "warn",
                         "text": "No MODIS-VIIRS overlap is loaded, so VIIRS could not be calibrated. The harmonized series shows MODIS only."})
    if any("provisional" in r["flags"] for r in shown):
        warnings.append({"code": "provisional", "level": "info",
                         "text": "The most recent months use near-real-time (NRT) data. They are provisional and will change when science-quality data replaces them."})
    if meta.get("demo"):
        warnings.append({"code": "demo", "level": "warn", "text": "SYNTHETIC DEMO DATA. These are not real fire detections."})

    current = current_standing(aoi, p, b0, b1) if frac > 0.001 else None
    return {
        "aoi": {"area_km2": area, "bbox": list(aoi.bounds), "cells": int(len(cells)), "coverage_fraction": frac,
                "centroid": [aoi.geom.centroid.x, aoi.geom.centroid.y]},
        "params": {"start": p.start, "end": p.end, "metric": p.metric, "view": p.view, "confidence": p.confidence,
                   "unit": METRIC_LABEL[p.metric][0], "unit_long": METRIC_LABEL[p.metric][1]},
        "data": {"start": meta["data_start"], "end": meta["data_end"], "demo": meta.get("demo", False)},
        "baseline": {"start_year": b0, "end_year": b1},
        "monthly": shown,
        "years": sorted({r["year"] for r in shown}),
        "current": current,
        "seasonality": seasonality,
        "annual": annual,
        "trend": tr,
        "rankings": {"months": top_months, "years": top_years},
        "peak": peak,
        "harmonization": harmon,
        "warnings": warnings,
    }


def _region_for(aoi: Aoi) -> str:
    c = aoi.geom.centroid
    loaded = db.meta().get("regions", {})
    best, best_area = "all", float("inf")
    for rid, r in config.regions().items():
        w, s, e, n = r.bbox
        if loaded.get(rid, {}).get("loaded") and w <= c.x <= e and s <= c.y <= n and (e - w) * (n - s) < best_area:
            best, best_area = rid, (e - w) * (n - s)
    return best


def daily(aoi: Aoi, p: Params, ym: str) -> dict:
    """Daily series for one month with the historical envelope and a to-date comparison."""
    try:
        year, month = int(ym[:4]), int(ym[5:7])
        assert 1 <= month <= 12
    except (ValueError, AssertionError) as exc:
        raise aoimod.AoiError("month must look like 2024-03") from exc
    mat, fx = _daily_matrix(aoi, p, month)
    if year not in mat.index:
        raise aoimod.AoiError(f"{ym} is outside the loaded record for this view.")
    mf = monthly_frame(aoi, p)
    b0, b1 = _baseline_years(p, mf, fx.data_end.year)
    ndays = calendar.monthrange(year, month)[1]
    ref = mat[(mat.index >= b0) & (mat.index <= b1) & (mat.index != year)]
    cum_ref = ref.loc[:, 1:ndays].cumsum(axis=1, skipna=False)
    cov = _coverage(fx)
    days, running = [], 0.0
    last_day = None
    for d in range(1, ndays + 1):
        v = mat.at[year, d]
        have = not math.isnan(v)
        if have:
            running += v
            last_day = d
        env = stats.envelope(ref[d].to_numpy()) if len(ref) else None
        cr = cum_ref[d].dropna().to_numpy() if len(ref) else np.array([])
        days.append({
            "day": d, "date": date(year, month, d), "value": v if have else None, "cumulative": running if have else None,
            "min": env and env["min"], "p25": env and env["p25"], "median": env and env["median"],
            "p75": env and env["p75"], "max": env and env["max"],
            "cum_median": float(np.median(cr)) if cr.size else None,
            "cum_p25": float(np.percentile(cr, 25)) if cr.size else None,
            "cum_p75": float(np.percentile(cr, 75)) if cr.size else None,
            "provisional": bool(cov.get("nrt_date") and date(year, month, d) >= cov["nrt_date"]),
        })
    to_date = None
    if last_day:
        cr = cum_ref[last_day].dropna().to_numpy() if len(ref) else np.array([])
        a = stats.anomaly(running, cr)
        to_date = {"days": last_day, "value": running, "full_month": last_day == ndays, "label": stats.CLASS_LABELS[a["cls"]], **a}
    return {"ym": f"{year}-{month:02d}", "year": year, "month": month, "days": days, "to_date": to_date,
            "baseline": {"start_year": b0, "end_year": b1}, "unit": METRIC_LABEL[p.metric][0]}


def leaderboard() -> list[dict]:
    """Current month-to-date anomaly for every loaded preset region, most unusual first."""
    def run() -> list[dict]:
        out = []
        loaded = db.meta().get("regions", {})
        for rid, r in config.regions().items():
            if not loaded.get(rid, {}).get("loaded"):
                continue
            s = summarize(aoimod.from_bbox(*r.bbox), Params())
            c = s["current"]
            if not c:
                continue
            out.append({"id": rid, "name": r.name, "story": r.story, "blurb": r.blurb, "bbox": list(r.bbox),
                        "value": c["value"], "median": c["median"], "ratio": c["ratio"], "percentile": c["percentile"],
                        "cls": c["cls"], "label": c["label"], "headline": c["headline"], "provisional": c["provisional"],
                        "peak_month": s["seasonality"]["peak_month"], "season": s["seasonality"]["season"]["months"],
                        "spark": [m["value"] for m in s["monthly"][-24:]]})
        out.sort(key=lambda x: (-(x["percentile"] if x["percentile"] is not None else -1), -(x["ratio"] or 0)))
        for i, row in enumerate(out):
            row["rank"] = i + 1
        return out

    return _cache.get_or_set(f"{aoimod.stamp()}:leaderboard", run)


def clear_cache() -> None:
    _cache.clear()
    aoimod.clear_caches()
