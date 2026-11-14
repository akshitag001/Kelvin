"""FastAPI app. Serves /api/* and, in production, the built frontend from frontend/dist."""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, timezone
from typing import Any, Iterator, Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from kelvin import __version__, config, db, grid
from kelvin.analytics import aoi as aoimod
from kelvin.analytics import briefing as briefmod
from kelvin.analytics import summary as summ
from kelvin.analytics.aoi import AoiError

log = logging.getLogger("kelvin")
app = FastAPI(title="KELVIN API", version=__version__, description="Harmonized MODIS + VIIRS burning activity calendar")
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ models
class Circle(BaseModel):
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    radius_km: float = Field(gt=0, le=1500)


class AoiRequest(BaseModel):
    geojson: dict[str, Any] | None = None
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    point: Circle | None = None
    region: str | None = None
    name: str | None = None
    start: date | None = None
    end: date | None = None
    metric: Literal["cells", "detections", "frp"] = "cells"
    view: Literal["harmonized", "modis", "viirs"] = "harmonized"
    confidence: Literal["all", "nominal", "high"] = "nominal"
    baseline: list[int] | None = Field(default=None, min_length=2, max_length=2)

    @model_validator(mode="after")
    def one_shape(self):
        given = sum(x is not None for x in (self.geojson, self.bbox, self.point, self.region))
        if given != 1:
            raise ValueError("Give exactly one of geojson, bbox, point or region.")
        return self

    def to_aoi(self) -> aoimod.Aoi:
        if self.region:
            r = config.regions().get(self.region)
            if not r:
                raise AoiError(f"Unknown region '{self.region}'.")
            return aoimod.from_bbox(*r.bbox)
        if self.bbox:
            return aoimod.from_bbox(*self.bbox)
        if self.point:
            return aoimod.from_circle(self.point.lon, self.point.lat, self.point.radius_km)
        return aoimod.from_geojson(self.geojson or {})

    def params(self) -> summ.Params:
        return summ.Params(start=self.start, end=self.end, metric=self.metric, view=self.view,
                           confidence=self.confidence, baseline=tuple(self.baseline) if self.baseline else None)

    def display_name(self) -> str | None:
        if self.name:
            return self.name
        if self.region and self.region in config.regions():
            return config.regions()[self.region].name
        return None


class DailyRequest(AoiRequest):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")


class HotspotRequest(AoiRequest):
    color_by: Literal["frp", "year"] = "frp"
    month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


@app.exception_handler(AoiError)
async def aoi_error(_: Request, exc: AoiError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


def _need_db() -> None:
    if not db.exists():
        raise HTTPException(503, "No data has been built yet. Run `python -m kelvin demo-data` or `python -m kelvin build`.")


def _ok(obj: Any) -> JSONResponse:
    return JSONResponse(summ.jsonable(obj))


# ------------------------------------------------------------------ status
@app.get("/api/status")
def status():
    base = {"version": __version__, "map_key": bool(config.map_key()), "attribution": config.ATTRIBUTION}
    if not db.exists():
        return _ok({**base, "ready": False, "demo": None,
                    "message": "No data built yet. Run `python -m kelvin demo-data` or `python -m kelvin build`."})
    m = db.meta()
    cal = m.get("calibration", {})
    sp_ends = [c["sp_end"] for c in m.get("coverage", {}).values() if c.get("sp_end")]
    nrt = [c["nrt_start"] for c in m.get("coverage", {}).values() if c.get("nrt_start")]
    return _ok({**base, "ready": True, "demo": m.get("demo", False), "built_at": m.get("built_at"),
                "last_refresh": m.get("last_refresh"), "data_start": m.get("data_start"), "data_end": m.get("data_end"),
                "coverage": m.get("coverage", {}), "coverage_boxes": m.get("coverage_boxes", []),
                "sp_nrt_boundary": {"sp_end": min(sp_ends) if sp_ends else None, "nrt_start": min(nrt) if nrt else None},
                "detections": m.get("detections"), "cells": m.get("cells"),
                "harmonization": {"version": m.get("harmonization_version"), "switch_date": cal.get("switch_date"),
                                  "calibration_start": cal.get("calibration_start"), "calibration_end": cal.get("calibration_end"),
                                  "global_k": cal.get("factors", {}).get("cells:nominal", {}).get("global_k")},
                "keep_types": m.get("keep_types")})


@app.get("/api/regions")
def regions():
    loaded = db.meta().get("regions", {}) if db.exists() else {}
    return _ok([{"id": rid, "name": r.name, "bbox": list(r.bbox), "priority": r.priority, "blurb": r.blurb, "story": r.story,
                 "center": list(r.center), **loaded.get(rid, {"loaded": False, "cells": 0})}
                for rid, r in config.regions().items()])


# ------------------------------------------------------------------ analytics
@app.post("/api/aoi/summary")
def aoi_summary(req: AoiRequest):
    _need_db()
    return _ok(summ.summarize(req.to_aoi(), req.params()))


@app.post("/api/aoi/daily")
def aoi_daily(req: DailyRequest):
    _need_db()
    return _ok(summ.daily(req.to_aoi(), req.params(), req.month))


@app.post("/api/aoi/briefing")
def aoi_briefing(req: AoiRequest):
    _need_db()
    s = summ.summarize(req.to_aoi(), req.params())
    return _ok(briefmod.build(summ.jsonable(s), req.display_name()))


@app.get("/api/leaderboard")
def leaderboard():
    _need_db()
    return _ok({"as_of": db.meta().get("data_end"), "regions": summ.leaderboard()})


# ------------------------------------------------------------------ hotspots
def _det_query(aoi: aoimod.Aoi, start: date | None, end: date | None, conf: int, columns: str, extra: str = "") -> tuple[str, list]:
    w, s, e, n = aoi.bounds
    sql = (f"SELECT {columns} FROM read_parquet('{config.detections_dir().as_posix()}/*/*.parquet', hive_partitioning = true) "
           "WHERE longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ? AND conf_level >= ?")
    args: list[Any] = [w, e, s, n, conf]
    if start:
        sql += " AND acq_date >= ? AND year >= ?"
        args += [start, start.year]
    if end:
        sql += " AND acq_date <= ? AND year <= ?"
        args += [end, end.year]
    return sql + extra, args


def _inside(aoi: aoimod.Aoi, df: pd.DataFrame) -> pd.DataFrame:
    if aoi.rect or df.empty:
        return df
    import shapely
    return df[shapely.contains_xy(aoi.geom, df["longitude"].to_numpy(), df["latitude"].to_numpy())]


def _month_bounds(ym: str) -> tuple[date, date]:
    import calendar
    y, m = int(ym[:4]), int(ym[5:7])
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


@app.post("/api/aoi/hotspots")
def aoi_hotspots(req: HotspotRequest):
    """Raw points when few, else a grid aggregation sized to the AOI."""
    _need_db()
    aoi = req.to_aoi()
    start, end = (_month_bounds(req.month) if req.month else (req.start, req.end))
    conf = config.CONF_LEVELS[req.confidence]
    limit = config.settings()["api"]["max_raw_points"]
    cur = db.connect()
    sql, args = _det_query(aoi, start, end, conf, "latitude, longitude, acq_date, acq_time, satellite, frp, provisional, year",
                           f" LIMIT {limit * 4 + 1}")
    df = _inside(aoi, cur.execute(sql, args).df())
    if len(df) <= limit:
        feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(r.longitude, 4), round(r.latitude, 4)]},
                  "properties": {"date": str(r.acq_date)[:10], "time": f"{int(r.acq_time):04d}", "satellite": r.satellite,
                                 "frp": None if pd.isna(r.frp) else round(float(r.frp), 1), "year": int(r.year),
                                 "provisional": bool(r.provisional)}}
                 for r in df.itertuples(index=False)]
        return _ok({"type": "FeatureCollection", "mode": "points", "count": len(feats), "features": feats})
    w, s, e, n = aoi.bounds
    step = max(0.01, round(max(e - w, n - s) / 120, 3))
    sql, args = _det_query(aoi, start, end, conf,
                           f"floor(longitude / {step}) AS gx, floor(latitude / {step}) AS gy, count(*) AS n, "
                           "sum(frp) AS frp, max(year) AS year", " GROUP BY gx, gy")
    g = cur.execute(sql, args).df()
    g["lon"], g["lat"] = (g["gx"] + 0.5) * step, (g["gy"] + 0.5) * step
    g = _inside(aoi, g.rename(columns={"lon": "longitude", "lat": "latitude"}))
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(r.longitude, 4), round(r.latitude, 4)]},
              "properties": {"n": int(r.n), "frp": float(r.frp or 0), "year": int(r.year)}} for r in g.itertuples(index=False)]
    return _ok({"type": "FeatureCollection", "mode": "grid", "cell_deg": step, "count": int(g["n"].sum()), "features": feats})


def _csv_header(req: AoiRequest, aoi: aoimod.Aoi, kind: str) -> str:
    m = db.meta()
    lines = [
        f"KELVIN {kind} export",
        "SYNTHETIC DEMO DATA - NOT REAL FIRE DETECTIONS" if m.get("demo") else "Source: NASA FIRMS active fire detections",
        f"generated_utc: {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
        f"aoi_bbox: {','.join(f'{v:.4f}' for v in aoi.bounds)}",
        f"aoi_area_km2: {aoimod.area_km2(aoi.geom):.0f}",
        f"start: {req.start or m.get('data_start')}  end: {req.end or m.get('data_end')}",
        f"metric: {req.metric}  view: {req.view}  confidence: {req.confidence} (low confidence dropped unless 'all')",
        f"type_filter: keep FIRMS type {m.get('keep_types')} (NRT rows have no type column and are kept)",
        f"harmonization_version: {m.get('harmonization_version')}",
        "dates: UTC acq_date; acq_time is HHMM UTC",
        config.ATTRIBUTION,
        "Hotspots are satellite detections of heat, not confirmed fires.",
    ]
    return "".join(f"# {l}\n" for l in lines)


@app.post("/api/aoi/hotspots.csv")
def aoi_hotspots_csv(req: AoiRequest):
    """Streaming CSV of raw detections."""
    _need_db()
    aoi = req.to_aoi()
    conf = config.CONF_LEVELS[req.confidence]
    cols = ("latitude, longitude, acq_date, acq_time, sensor, satellite, product, provisional, confidence, frp, "
            "brightness, daynight, type, cell_id")
    sql, args = _det_query(aoi, req.start, req.end, conf, cols, f" ORDER BY acq_date, acq_time LIMIT {config.settings()['api']['csv_max_rows']}")
    header = _csv_header(req, aoi, "hotspots")

    def gen() -> Iterator[bytes]:
        yield header.encode()
        yield (cols.replace(" ", "") + "\n").encode()
        cur = db.connect()
        res = cur.execute(sql, args)
        reader = res.to_arrow_reader(100_000) if hasattr(res, "to_arrow_reader") else res.fetch_record_batch(100_000)
        for batch in reader:
            df = _inside(aoi, batch.to_pandas())
            if df.empty:
                continue
            df["acq_date"] = pd.to_datetime(df["acq_date"]).dt.strftime("%Y-%m-%d")
            df["acq_time"] = df["acq_time"].map(lambda t: f"{int(t):04d}")
            df["type"] = df["type"].where(df["type"] >= 0, "")
            buf = io.StringIO()
            df.to_csv(buf, index=False, header=False, lineterminator="\n", float_format="%.5g")
            yield buf.getvalue().encode()

    fname = f"kelvin_hotspots_{date.today():%Y%m%d}.csv"
    return StreamingResponse(gen(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@app.post("/api/aoi/calendar.csv")
def aoi_calendar_csv(req: AoiRequest):
    _need_db()
    aoi = req.to_aoi()
    s = summ.jsonable(summ.summarize(aoi, req.params()))
    buf = io.StringIO()
    buf.write(_csv_header(req, aoi, "monthly calendar"))
    buf.write(f"# unit: {s['params']['unit_long']}\n# baseline_years: {s['baseline']['start_year']}-{s['baseline']['end_year']}\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["month", "value", "harmonized", "harmonized_lo90", "harmonized_hi90", "modis_native", "viirs_native_unscaled",
                "viirs_scaled", "source", "baseline_median", "ratio_to_median", "percentile", "robust_z", "class", "flags"])
    for r in s["monthly"]:
        w.writerow([r["ym"], r["value"], r["harmonized"], r["lo"], r["hi"], r["modis"], r["viirs"], r["viirs_scaled"],
                    r["source"], r["median"], r["ratio"], r["percentile"], r["z"], r["cls"], ";".join(r["flags"])])
    return StreamingResponse(iter([buf.getvalue().encode()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="kelvin_calendar_{date.today():%Y%m%d}.csv"'})


# ------------------------------------------------------------------ diagnostics
@app.get("/api/harmonization/diagnostics")
def diagnostics(region: str = Query("all"), metric: Literal["cells", "detections", "frp"] = "cells",
                confidence: Literal["all", "nominal", "high"] = "nominal"):
    _need_db()
    conf = config.CONF_LEVELS[confidence]
    cur = db.connect()
    m = db.meta()
    cal = m.get("calibration", {})
    f = cal.get("factors", {}).get(f"{metric}:{confidence}", {})
    regions_cv = cur.execute("SELECT region, n_months, mape, wmape, bias, r2, spearman FROM cv WHERE metric = ? AND conf = ? ORDER BY region",
                             [metric, conf]).df()
    pts = cur.execute("SELECT ym, modis, viirs_raw, viirs_scaled FROM cv_points WHERE metric = ? AND conf = ? AND region = ? ORDER BY ym",
                      [metric, conf, region]).df()
    ktab = cur.execute("SELECT block_id, season, k, k_lo, k_hi, n_viirs, raw_ratio, level FROM calibration WHERE metric = ? AND conf = ?",
                       [metric, conf]).df()
    if region != "all" and region in config.regions():
        w, s, e, n = config.regions()[region].bbox
        lat, lon = grid.block_corner(ktab["block_id"].to_numpy())
        ktab = ktab[(lon + 1 > w) & (lon < e) & (lat + 1 > s) & (lat < n)]
    lat, lon = grid.block_corner(ktab["block_id"].to_numpy())
    ktab = ktab.assign(lat=lat, lon=lon).sort_values("n_viirs", ascending=False)
    levels = ktab.groupby("level")["n_viirs"].sum()
    terra = cur.execute("SELECT month, sum(f * n) / nullif(sum(n), 0) AS f, sum(n) AS n FROM terra_factor WHERE metric = ? AND conf = ? GROUP BY month ORDER BY month",
                        [metric, conf]).df()
    season_k = (ktab.assign(w=ktab["n_viirs"]).groupby("season")
                .apply(lambda g: pd.Series({"k": np.average(g["k"], weights=g["w"]) if g["w"].sum() > 0 else g["k"].mean(),
                                            "n": g["w"].sum()}), include_groups=False).reset_index())
    return _ok({
        "region": region, "metric": metric, "confidence": confidence,
        "global_k": f.get("global_k"), "global_k_lo": f.get("global_k_lo"), "global_k_hi": f.get("global_k_hi"),
        "terra_global": f.get("terra_global"), "chain": f.get("chain", {}),
        "calibration_window": [cal.get("calibration_start"), cal.get("calibration_end")], "switch_date": cal.get("switch_date"),
        "cv": regions_cv.to_dict("records"),
        "scatter": pts.to_dict("records"),
        "k_table": ktab.head(400).to_dict("records"),
        "k_by_season": season_k.to_dict("records"),
        "level_share": {k: float(v / levels.sum()) for k, v in levels.items()} if levels.sum() > 0 else {},
        "terra_factor": terra.to_dict("records"),
        "demo": m.get("demo", False),
    })


@app.get("/api/health")
def health():
    return {"ok": True}


# ------------------------------------------------------------------ static frontend
_dist = config.ROOT / "frontend" / "dist"
if (_dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        target = (_dist / path).resolve()
        if path and target.is_file() and _dist.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(_dist / "index.html")
