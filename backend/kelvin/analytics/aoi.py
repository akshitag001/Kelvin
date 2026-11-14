"""Area of interest: geometry handling, cell selection and the aggregate queries."""
from __future__ import annotations

import hashlib
import math
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from kelvin import config, db, grid


class AoiError(ValueError):
    """Invalid or unsupported area of interest (reported to the user as HTTP 422)."""


@dataclass(frozen=True)
class Aoi:
    geom: BaseGeometry
    rect: bool
    key: str

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return self.geom.bounds  # west, south, east, north


def _make(geom: BaseGeometry, rect: bool) -> Aoi:
    if geom.is_empty:
        raise AoiError("The area is empty.")
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        polys = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            raise AoiError("The area must be a polygon.")
        geom = unary_union(polys)
    w, s, e, n = geom.bounds
    if w < -180 or e > 180 or s < -90 or n > 90:
        raise AoiError("Coordinates must be longitude -180..180 and latitude -90..90.")
    area = area_km2(geom)
    limit = config.settings()["api"]["max_aoi_area_km2"]
    if area > limit:
        raise AoiError(f"The area is {area:,.0f} km2; the limit is {limit:,.0f} km2. Draw a smaller area.")
    if area <= 0:
        raise AoiError("The area has zero size.")
    return Aoi(geom=geom, rect=rect, key=hashlib.sha1(shapely.to_wkb(geom)).hexdigest())


def from_bbox(west: float, south: float, east: float, north: float) -> Aoi:
    if not (west < east and south < north):
        raise AoiError("Bounding box must have west < east and south < north.")
    return _make(box(west, south, east, north), rect=True)


def from_geojson(obj: dict[str, Any]) -> Aoi:
    try:
        if obj.get("type") == "FeatureCollection":
            geom = unary_union([shape(f["geometry"]) for f in obj["features"] if f.get("geometry")])
        elif obj.get("type") == "Feature":
            geom = shape(obj["geometry"])
        else:
            geom = shape(obj)
    except Exception as exc:  # malformed GeoJSON
        raise AoiError(f"Could not read the GeoJSON geometry: {exc}") from exc
    return _make(geom, rect=False)


def from_circle(lon: float, lat: float, radius_km: float) -> Aoi:
    if not (0 < radius_km <= 1500):
        raise AoiError("Radius must be between 0 and 1500 km.")
    if abs(lat) > 85:
        raise AoiError("Point + radius is not supported above 85 degrees latitude.")
    ang = np.linspace(0, 2 * math.pi, 73)[:-1]
    dlat = radius_km / 111.195
    dlon = dlat / max(math.cos(math.radians(lat)), 0.05)
    pts = np.column_stack([lon + dlon * np.cos(ang), lat + dlat * np.sin(ang)])
    return _make(shapely.Polygon(pts), rect=False)


def area_km2(geom: BaseGeometry) -> float:
    """Area on the equal-area sinusoidal projection."""
    def proj(xy: np.ndarray) -> np.ndarray:
        lat_r = np.radians(xy[:, 1])
        return np.column_stack([grid.R * np.radians(xy[:, 0]) * np.cos(lat_r), grid.R * lat_r])

    return float(shapely.transform(shapely.segmentize(geom, 0.25), proj).area / 1e6)


def coverage_fraction(geom: BaseGeometry, boxes: list[dict]) -> float:
    if not boxes:
        return 0.0
    cover = unary_union([box(*b["bbox"]) for b in boxes])
    return float(geom.intersection(cover).area / geom.area) if geom.area > 0 else 0.0


# ---------------------------------------------------------------- LRU cache
class LRU:
    def __init__(self, size: int):
        self.size = size
        self._d: OrderedDict[str, Any] = OrderedDict()
        self._lock = threading.Lock()

    def get_or_set(self, key: str, fn: Callable[[], Any]) -> Any:
        with self._lock:
            if key in self._d:
                self._d.move_to_end(key)
                return self._d[key]
        value = fn()
        with self._lock:
            self._d[key] = value
            while len(self._d) > self.size:
                self._d.popitem(last=False)
        return value

    def clear(self) -> None:
        with self._lock:
            self._d.clear()


_cells_cache = LRU(32)
_query_cache = LRU(96)


def stamp() -> str:
    """Changes whenever the database file is rebuilt, so caches never serve stale data."""
    return f"{config.db_path()}:{config.db_path().stat().st_mtime_ns}"


def clear_caches() -> None:
    _cells_cache.clear()
    _query_cache.clear()


def select_cells(aoi: Aoi) -> pd.DataFrame:
    """Cells whose centre lies inside the AOI: bbox prefilter in SQL, exact test with shapely."""
    def run() -> pd.DataFrame:
        w, s, e, n = aoi.bounds
        df = db.connect().execute(
            "SELECT cell_id, block_id, lat, lon FROM cells WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?",
            [w, e, s, n],
        ).df()
        if not aoi.rect and not df.empty:
            inside = shapely.contains_xy(aoi.geom, df["lon"].to_numpy(), df["lat"].to_numpy())
            df = df[inside]
        return df[["cell_id", "block_id"]].reset_index(drop=True)

    return _cells_cache.get_or_set(f"{stamp()}:{aoi.key}", run)


_MONTH_COLS = {
    "cells": "sum(m.cd_modis) AS M, sum(m.cd_terra) AS T, sum(m.cd_snpp) AS V, sum(m.cd_n20) AS V20, sum(m.cd_n21) AS V21",
    "detections": "sum(m.nd_terra + m.nd_aqua) AS M, sum(m.nd_terra) AS T, sum(m.nd_snpp) AS V, sum(m.nd_n20) AS V20, sum(m.nd_n21) AS V21",
    "frp": "sum(m.frp_terra + m.frp_aqua) AS M, sum(m.frp_terra) AS T, sum(m.frp_snpp) AS V, sum(m.frp_n20) AS V20, sum(m.frp_n21) AS V21",
}
_DAY_COLS = {
    "cells": ("count(*) FILTER ((m.sat_mask & 3) <> 0) AS M, count(*) FILTER ((m.sat_mask & 1) <> 0) AS T, "
              "count(*) FILTER ((m.sat_mask & 4) <> 0) AS V, count(*) FILTER ((m.sat_mask & 8) <> 0) AS V20, "
              "count(*) FILTER ((m.sat_mask & 16) <> 0) AS V21"),
    "detections": _MONTH_COLS["detections"],
    "frp": _MONTH_COLS["frp"],
}


def monthly_blocks(aoi: Aoi, metric: str, conf: int) -> pd.DataFrame:
    """Per (block, month) sums for the AOI: columns block_id, ym, M, T, V, V20, V21."""
    def run() -> pd.DataFrame:
        sel = select_cells(aoi)
        cur = db.connect()
        cur.register("sel", sel)
        return cur.execute(
            f"SELECT sel.block_id, m.ym, {_MONTH_COLS[metric]} FROM cellmonth m JOIN sel USING (cell_id) "
            "WHERE m.conf = ? GROUP BY sel.block_id, m.ym", [conf]).df().astype({"M": "float64", "T": "float64", "V": "float64", "V20": "float64", "V21": "float64"})

    return _query_cache.get_or_set(f"{stamp()}:m:{aoi.key}:{metric}:{conf}", run)


def daily_blocks(aoi: Aoi, metric: str, conf: int, month: int) -> pd.DataFrame:
    """Per (block, date) sums for one calendar month across all years."""
    def run() -> pd.DataFrame:
        sel = select_cells(aoi)
        cur = db.connect()
        cur.register("sel", sel)
        return cur.execute(
            f"SELECT sel.block_id, m.date, {_DAY_COLS[metric]} FROM cellday m JOIN sel USING (cell_id) "
            "WHERE m.conf = ? AND month(m.date) = ? GROUP BY sel.block_id, m.date", [conf, month]).df().astype(
                {"M": "float64", "T": "float64", "V": "float64", "V20": "float64", "V21": "float64"})

    return _query_cache.get_or_set(f"{stamp()}:d:{aoi.key}:{metric}:{conf}:{month}", run)
