"""Normalize raw FIRMS CSV rows (MODIS or VIIRS, SP or NRT) into one schema.

Output columns:
  latitude, longitude, acq_date (datetime64[D]), acq_time (int HHMM, UTC),
  satellite (Terra/Aqua/SNPP/NOAA20/NOAA21), sensor (MODIS/VIIRS),
  product (SP/NRT), confidence (l/n/h), conf_level (0/1/2), frp, brightness,
  daynight (D/N), type (Int8, -1 when the product has no type column).
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

from kelvin.config import settings

UNIFIED_COLUMNS = [
    "latitude", "longitude", "acq_date", "acq_time", "satellite", "sensor",
    "product", "confidence", "conf_level", "frp", "brightness", "daynight", "type",
]

_MODIS_SAT = {"terra": "Terra", "t": "Terra", "aqua": "Aqua", "a": "Aqua"}
_VIIRS_SAT = {
    "n": "SNPP", "snpp": "SNPP", "npp": "SNPP", "suomi npp": "SNPP", "suomi-npp": "SNPP",
    "1": "NOAA20", "n20": "NOAA20", "noaa20": "NOAA20", "noaa-20": "NOAA20", "j1": "NOAA20",
    "2": "NOAA21", "n21": "NOAA21", "noaa21": "NOAA21", "noaa-21": "NOAA21", "j2": "NOAA21",
}


def detect_sensor(columns) -> str:
    """MODIS files carry `brightness`/`bright_t31`; VIIRS carry `bright_ti4`/`bright_ti5`."""
    cols = {str(c).strip().lower() for c in columns}
    if "bright_ti4" in cols or "bright_ti5" in cols:
        return "VIIRS"
    if "brightness" in cols or "bright_t31" in cols:
        return "MODIS"
    raise ValueError(f"Cannot tell MODIS from VIIRS; columns: {sorted(cols)}")


def hints_from_name(name: str) -> tuple[str | None, str | None]:
    """Guess (satellite, product) from a FIRMS file or source name.

    Archive downloads are named like fire_archive_SV-C2_12345.csv (SNPP, SP),
    fire_nrt_J1V-C2_12345.csv (NOAA-20, NRT), fire_archive_M-C61_12345.csv (MODIS).
    """
    n = name.lower()
    product = None
    if "nrt" in n:
        product = "NRT"
    elif "archive" in n or re.search(r"(^|[_\-])sp([_\-.]|$)", n):
        product = "SP"
    sat = None
    if re.search(r"j2v|noaa[-_]?21|n21", n):
        sat = "NOAA21"
    elif re.search(r"j1v|noaa[-_]?20|n20", n):
        sat = "NOAA20"
    elif re.search(r"sv-c|snpp|suomi|npp", n):
        sat = "SNPP"
    return sat, product


def normalize(
    df: pd.DataFrame,
    *,
    satellite: str | None = None,
    product: str | None = None,
) -> pd.DataFrame:
    """Map a raw FIRMS frame onto the unified schema. No rows are filtered here."""
    if df.empty:
        return pd.DataFrame(columns=UNIFIED_COLUMNS)
    df = df.rename(columns={c: str(c).strip().lower() for c in df.columns})
    sensor = detect_sensor(df.columns)
    cfg = settings()["cleaning"]
    out = pd.DataFrame(index=df.index)
    out["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    out["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    out["acq_date"] = pd.to_datetime(df["acq_date"], errors="coerce").dt.normalize()
    out["acq_time"] = (
        pd.to_numeric(df["acq_time"].astype(str).str.replace(":", "", regex=False), errors="coerce")
        .fillna(0).astype("int32")
    )

    raw_sat = df["satellite"].astype(str).str.strip().str.lower() if "satellite" in df else None
    if sensor == "MODIS":
        if raw_sat is None:
            raise ValueError("MODIS file without a satellite column")
        out["satellite"] = raw_sat.map(_MODIS_SAT)
    elif satellite:
        out["satellite"] = satellite
    elif raw_sat is not None:
        out["satellite"] = raw_sat.map(_VIIRS_SAT)
    else:
        raise ValueError("VIIRS file without a satellite column or a file-name hint")
    out["sensor"] = sensor

    if product:
        out["product"] = product
    elif "version" in df:
        # NRT versions end in "NRT" (e.g. 6.1NRT, 2.0NRT); URT/RT are faster NRT variants.
        ver = df["version"].astype(str).str.upper()
        out["product"] = np.where(ver.str.contains("RT"), "NRT", "SP")
    else:
        out["product"] = "SP"

    conf = df["confidence"]
    if sensor == "MODIS":
        c = pd.to_numeric(conf, errors="coerce").fillna(0)
        level = np.where(c >= cfg["modis_high_from"], 2, np.where(c >= cfg["modis_low_below"], 1, 0))
    else:
        c = conf.astype(str).str.strip().str.lower().str[:1]
        level = c.map({"l": 0, "n": 1, "h": 2}).fillna(1).to_numpy()
    out["conf_level"] = np.asarray(level, dtype="int8")
    out["confidence"] = pd.Series(out["conf_level"]).map({0: "l", 1: "n", 2: "h"}).to_numpy()

    out["frp"] = pd.to_numeric(df["frp"], errors="coerce").astype("float32") if "frp" in df else np.float32("nan")
    bcol = "brightness" if sensor == "MODIS" else "bright_ti4"
    out["brightness"] = pd.to_numeric(df[bcol], errors="coerce").astype("float32") if bcol in df else np.float32("nan")
    out["daynight"] = df["daynight"].astype(str).str.upper().str[:1] if "daynight" in df else "U"
    out["type"] = (
        pd.to_numeric(df["type"], errors="coerce").fillna(-1).astype("int8") if "type" in df else np.int8(-1)
    )

    out = out.dropna(subset=["latitude", "longitude", "acq_date", "satellite"])
    out = out[out["latitude"].between(-90, 90) & out["longitude"].between(-180, 180)]
    return out[UNIFIED_COLUMNS].reset_index(drop=True)


def filter_types(df: pd.DataFrame, keep_types: list[int] | None = None) -> pd.DataFrame:
    """Keep presumed vegetation fires. Rows without a type column (-1, all NRT) are kept."""
    keep = set(settings()["cleaning"]["keep_types"] if keep_types is None else keep_types)
    return df[df["type"].isin(keep | {-1})]
