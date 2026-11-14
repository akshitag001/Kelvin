"""Equal-area ~1 km grid on the MODIS sinusoidal projection.

x = R * lon_rad * cos(lat_rad), y = R * lat_rad, cell = floor(coord / 1000 m).
Every cell covers 1 km2 regardless of latitude, so a count of cells is an area.
"""
from __future__ import annotations

import numpy as np

R = 6371007.181  # MODIS sphere radius, metres
CELL = 1000.0
_X_OFF = 20016  # cell_x lies in [-20016, 20015]
_Y_OFF = 10008  # cell_y lies in [-10008, 10007]
_X_SPAN = 40032


def cell_xy(lat, lon) -> tuple[np.ndarray, np.ndarray]:
    lat_r = np.radians(np.asarray(lat, dtype="float64"))
    lon_r = np.radians(np.asarray(lon, dtype="float64"))
    x = R * lon_r * np.cos(lat_r)
    y = R * lat_r
    return np.floor(x / CELL).astype("int64"), np.floor(y / CELL).astype("int64")


def cell_id(lat, lon) -> np.ndarray:
    cx, cy = cell_xy(lat, lon)
    return (cy + _Y_OFF) * _X_SPAN + (cx + _X_OFF)


def cell_center(cid) -> tuple[np.ndarray, np.ndarray]:
    """Cell id -> (lat, lon) of the cell centre in degrees."""
    cid = np.asarray(cid, dtype="int64")
    cy = cid // _X_SPAN - _Y_OFF
    cx = cid % _X_SPAN - _X_OFF
    lat_r = (cy + 0.5) * CELL / R
    cos = np.maximum(np.cos(lat_r), 1e-9)
    lon_r = (cx + 0.5) * CELL / (R * cos)
    lon = np.degrees(lon_r)
    return np.degrees(lat_r), np.clip(lon, -180.0, 180.0)


def block_id(lat, lon) -> np.ndarray:
    """1-degree block containing the point. Encodes (floor(lat), floor(lon))."""
    la = np.clip(np.floor(np.asarray(lat, dtype="float64")), -90, 89).astype("int64")
    lo = np.clip(np.floor(np.asarray(lon, dtype="float64")), -180, 179).astype("int64")
    return (la + 90) * 360 + (lo + 180)


def block_corner(bid) -> tuple[np.ndarray, np.ndarray]:
    """Block id -> (south, west) corner in degrees."""
    bid = np.asarray(bid, dtype="int64")
    return bid // 360 - 90, bid % 360 - 180


def tile_of_block(bid) -> np.ndarray:
    """10-degree 'region' tile used as the middle level of the shrinkage hierarchy."""
    lat, lon = block_corner(bid)
    return (np.floor_divide(lat + 90, 10)) * 36 + np.floor_divide(lon + 180, 10)
