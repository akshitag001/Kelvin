"""Paths, settings and region definitions. Cross-platform (pathlib only)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def data_dir() -> Path:
    """Data root. Override with KELVIN_DATA_DIR (used by the tests)."""
    p = Path(os.environ.get("KELVIN_DATA_DIR", ROOT / "data"))
    return p if p.is_absolute() else ROOT / p


def raw_dir() -> Path:
    return data_dir() / "raw"


def processed_dir() -> Path:
    return data_dir() / "processed"


def cache_dir() -> Path:
    return data_dir() / "cache"


def db_path() -> Path:
    return processed_dir() / "kelvin.duckdb"


def detections_dir() -> Path:
    return processed_dir() / "detections"


def map_keys() -> list[str]:
    """All configured FIRMS keys. FIRMS_MAP_KEY may hold several, separated by commas;
    FIRMS_MAP_KEYS is accepted too. The fetcher rotates between them."""
    raw = ",".join(os.environ.get(v, "") for v in ("FIRMS_MAP_KEY", "FIRMS_MAP_KEYS"))
    out: list[str] = []
    for k in (p.strip() for p in raw.split(",")):
        if k and k not in out:
            out.append(k)
    return out


def map_key() -> str | None:
    keys = map_keys()
    return keys[0] if keys else None


@dataclass(frozen=True)
class Region:
    id: str
    name: str
    bbox: tuple[float, float, float, float]  # west, south, east, north
    priority: int = 1
    blurb: str = ""
    story: str | None = None
    demo: dict[str, Any] | None = field(default=None, hash=False, compare=False)

    @property
    def center(self) -> tuple[float, float]:
        w, s, e, n = self.bbox
        return ((w + e) / 2, (s + n) / 2)


@lru_cache(maxsize=1)
def settings() -> dict[str, Any]:
    with open(ROOT / "config" / "settings.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@lru_cache(maxsize=1)
def regions() -> dict[str, Region]:
    with open(ROOT / "config" / "regions.yaml", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)["regions"]
    out: dict[str, Region] = {}
    for rid, r in raw.items():
        out[rid] = Region(
            id=rid,
            name=r["name"],
            bbox=tuple(float(v) for v in r["bbox"]),  # type: ignore[arg-type]
            priority=int(r.get("priority", 1)),
            blurb=r.get("blurb", ""),
            story=r.get("story"),
            demo=r.get("demo"),
        )
    return out


# Satellites, in sat_mask bit order.
SATELLITES = ["Terra", "Aqua", "SNPP", "NOAA20", "NOAA21"]
SAT_BIT = {s: 1 << i for i, s in enumerate(SATELLITES)}
SAT_COL = {"Terra": "terra", "Aqua": "aqua", "SNPP": "snpp", "NOAA20": "n20", "NOAA21": "n21"}
SENSOR_OF = {"Terra": "MODIS", "Aqua": "MODIS", "SNPP": "VIIRS", "NOAA20": "VIIRS", "NOAA21": "VIIRS"}

# FIRMS source name -> satellite (None = MODIS, decided per row from the satellite column).
SOURCES = {
    "MODIS_SP": (None, "SP"),
    "MODIS_NRT": (None, "NRT"),
    "VIIRS_SNPP_SP": ("SNPP", "SP"),
    "VIIRS_SNPP_NRT": ("SNPP", "NRT"),
    "VIIRS_NOAA20_SP": ("NOAA20", "SP"),
    "VIIRS_NOAA20_NRT": ("NOAA20", "NRT"),
    "VIIRS_NOAA21_SP": ("NOAA21", "SP"),
    "VIIRS_NOAA21_NRT": ("NOAA21", "NRT"),
}

# Confidence tiers used across the pipeline: minimum confidence kept.
CONF_LEVELS = {"all": 0, "nominal": 1, "high": 2}

ATTRIBUTION = (
    "Data: NASA FIRMS (LANCE/EOSDIS), MODIS and VIIRS active fire detections. "
    "NASA does not endorse this project."
)
