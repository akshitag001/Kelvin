"""`kelvin build`: raw FIRMS files -> cleaned detections (Parquet) -> DuckDB aggregates.

Stages
  1. stage   every raw file is normalized, type-filtered, gridded, written to staging Parquet
  2. dedupe  exact duplicates dropped; SP wins over NRT (same satellite, date, 10-degree tile)
  3. tables  detections (Parquet by year), cellday, cellmonth, cells, blockmonth, meta
"""
from __future__ import annotations

import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator

import duckdb
import numpy as np
import pandas as pd

from kelvin import config, db, grid
from kelvin.ingest import clean

CHUNK_ROWS = 1_500_000
SAT_COLS = ["terra", "aqua", "snpp", "n20", "n21"]


def _iter_raw(use_demo: bool) -> Iterator[tuple[str, str | None, str | None, pd.DataFrame, dict]]:
    """Yield (label, satellite_hint, product_hint, raw_frame, coverage_info)."""
    raw = config.raw_dir()
    if use_demo:
        for f in sorted((raw / "demo").glob("*.parquet")):
            sat, product = config.SOURCES.get(f.stem, (None, None))
            yield f"demo/{f.name}", sat, product, pd.read_parquet(f), {"kind": "demo"}
        return
    for source, (sat, product) in config.SOURCES.items():
        for f in sorted((raw / source).rglob("*.csv")):
            if f.stat().st_size < 60:
                continue
            region = f.relative_to(raw / source).parts[0]  # raw/{source}/{region}/{tile}/{window}.csv
            for chunk in pd.read_csv(f, chunksize=CHUNK_ROWS, low_memory=False):
                yield f"{source}/{region}/{f.name}", sat, product, chunk, {"kind": "region", "region": region}
    manual = raw / "manual"
    for f in sorted(manual.rglob("*")):
        suffix = f.suffix.lower()
        if suffix == ".csv":
            sat, product = clean.hints_from_name(f.name)
            for chunk in pd.read_csv(f, chunksize=CHUNK_ROWS, low_memory=False):
                yield f"manual/{f.name}", sat, product, chunk, {"kind": "manual", "file": f.name}
        elif suffix == ".zip":
            with zipfile.ZipFile(f) as zf:
                for member in zf.namelist():
                    if not member.lower().endswith(".csv"):
                        continue
                    sat, product = clean.hints_from_name(Path(member).name)
                    with zf.open(member) as fh:
                        for chunk in pd.read_csv(fh, chunksize=CHUNK_ROWS, low_memory=False):
                            yield f"manual/{f.name}:{member}", sat, product, chunk, {"kind": "manual", "file": f.name}


def has_real_raw() -> bool:
    raw = config.raw_dir()
    if any((raw / "manual").rglob("*.csv")) or any((raw / "manual").rglob("*.zip")):
        return True
    return any(any((raw / s).rglob("*.csv")) for s in config.SOURCES)


def _stage(use_demo: bool, staging: Path, log: Callable[[str], None]) -> tuple[int, list[dict]]:
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    n_total, part = 0, 0
    extents: dict[str, list[float]] = {}
    regions_seen: set[str] = set()
    for label, sat, product, raw, info in _iter_raw(use_demo):
        try:
            df = clean.normalize(raw, satellite=sat, product=product)
        except (ValueError, KeyError) as exc:
            log(f"  skipped {label}: {exc}")
            continue
        df = clean.filter_types(df)
        if df.empty:
            continue
        df["cell_id"] = grid.cell_id(df["latitude"].to_numpy(), df["longitude"].to_numpy())
        df["sat_bit"] = df["satellite"].map(config.SAT_BIT).astype("int8")
        df["tile"] = ((np.floor(df["latitude"] / 10) + 9) * 36 + np.floor(df["longitude"] / 10) + 18).astype("int16")
        df["year"] = df["acq_date"].dt.year.astype("int16")
        df["acq_date"] = df["acq_date"].dt.date
        df.to_parquet(staging / f"part_{part:05d}.parquet", index=False)
        part += 1
        n_total += len(df)
        if info["kind"] == "region":
            regions_seen.add(info["region"])
        elif info["kind"] == "manual":
            ext = extents.setdefault(info["file"], [180.0, 90.0, -180.0, -90.0])
            ext[0] = min(ext[0], float(df["longitude"].min()))
            ext[1] = min(ext[1], float(df["latitude"].min()))
            ext[2] = max(ext[2], float(df["longitude"].max()))
            ext[3] = max(ext[3], float(df["latitude"].max()))
        log(f"  staged {label}: {len(df):,} rows")

    boxes: list[dict] = []
    all_regions = config.regions()
    if use_demo:
        planted = config.raw_dir() / "demo" / "planted.json"
        ids = json.loads(planted.read_text(encoding="utf-8"))["regions"] if planted.exists() else []
        regions_seen.update(ids)
    for rid in regions_seen:
        if rid in all_regions:
            boxes.append({"id": rid, "name": all_regions[rid].name, "bbox": list(all_regions[rid].bbox)})
    for fname, ext in extents.items():
        bbox = [np.floor(ext[0] * 10) / 10, np.floor(ext[1] * 10) / 10, np.ceil(ext[2] * 10) / 10, np.ceil(ext[3] * 10) / 10]
        boxes.append({"id": f"import:{fname}", "name": f"Imported archive ({fname})", "bbox": [float(v) for v in bbox]})
    return n_total, boxes


def _sat_aggs(prefix: str, expr: str) -> str:
    return ",\n  ".join(
        f"{expr.format(sat=s)} AS {prefix}_{config.SAT_COL[s]}" for s in config.SATELLITES
    )


def build(use_demo: bool | None = None, log: Callable[[str], None] = print) -> dict:
    """Rebuild everything from raw files. Returns the meta dictionary."""
    if use_demo is None:
        use_demo = not has_real_raw()
    proc = config.processed_dir()
    proc.mkdir(parents=True, exist_ok=True)
    staging = proc / "staging"
    log(f"Staging raw files ({'SYNTHETIC DEMO DATA' if use_demo else 'real FIRMS data'}) ...")
    n_staged, boxes = _stage(use_demo, staging, log)
    if n_staged == 0:
        raise RuntimeError(
            "No raw detections found. Run `python -m kelvin demo-data`, `python -m kelvin fetch`, "
            "or put FIRMS archive files in data/raw/manual/ and run `python -m kelvin build`."
        )

    db.close()
    tmp = proc / "kelvin.duckdb.tmp"
    if tmp.exists():
        tmp.unlink()
    con = duckdb.connect(str(tmp))
    glob = (staging / "*.parquet").as_posix()
    log("Deduplicating (SP wins over NRT) ...")
    con.execute(f"""
        CREATE TEMP TABLE d1 AS
        SELECT * FROM read_parquet('{glob}')
        QUALIFY row_number() OVER (
            PARTITION BY latitude, longitude, acq_date, acq_time, satellite
            ORDER BY product DESC) = 1
    """)
    con.execute("CREATE TEMP TABLE spkeys AS SELECT DISTINCT satellite, acq_date, tile FROM d1 WHERE product = 'SP'")
    con.execute("""
        CREATE TEMP TABLE det AS
        SELECT d1.*, (d1.product = 'NRT') AS provisional
        FROM d1 LEFT JOIN spkeys k
          ON d1.product = 'NRT' AND k.satellite = d1.satellite AND k.acq_date = d1.acq_date AND k.tile = d1.tile
        WHERE k.satellite IS NULL
    """)
    n_det = con.execute("SELECT count(*) FROM det").fetchone()[0]
    log(f"  {n_staged:,} staged rows -> {n_det:,} unique detections")

    det_dir = config.detections_dir()
    if det_dir.exists():
        shutil.rmtree(det_dir)
    con.execute(f"""
        COPY (SELECT latitude, longitude, acq_date, acq_time, satellite, sensor, product, provisional,
                     confidence, conf_level, frp, brightness, daynight, type, cell_id, year
              FROM det ORDER BY acq_date, cell_id)
        TO '{det_dir.as_posix()}' (FORMAT PARQUET, PARTITION_BY (year))
    """)

    log("Aggregating cell-days and cell-months ...")
    nd = _sat_aggs("nd", "count(*) FILTER (satellite = '{sat}')")
    frp = _sat_aggs("frp", "coalesce(sum(frp) FILTER (satellite = '{sat}'), 0)::FLOAT")
    selects = " UNION ALL ".join(
        f"""SELECT cell_id, acq_date AS date, {c}::TINYINT AS conf,
                   bit_or(sat_bit)::TINYINT AS sat_mask,
                   {nd},
                   {frp},
                   bit_or(CASE daynight WHEN 'D' THEN 1 WHEN 'N' THEN 2 ELSE 0 END)::TINYINT AS dn_mask,
                   bool_or(provisional) AS provisional
            FROM det WHERE conf_level >= {c} GROUP BY cell_id, acq_date"""
        for c in (0, 1, 2)
    )
    con.execute(f"CREATE TABLE cellday AS SELECT * FROM ({selects}) ORDER BY conf, cell_id, date")
    bits = {"terra": 1, "aqua": 2, "modis": 3, "snpp": 4, "n20": 8, "n21": 16, "viirs": 28}
    cd = ", ".join(f"count(*) FILTER ((sat_mask & {b}) <> 0)::INTEGER AS cd_{n}" for n, b in bits.items())
    sums = ", ".join(f"sum(nd_{s})::INTEGER AS nd_{s}, sum(frp_{s})::FLOAT AS frp_{s}" for s in SAT_COLS)
    con.execute(f"""
        CREATE TABLE cellmonth AS
        SELECT cell_id, conf, (year(date) * 100 + month(date))::INTEGER AS ym, {cd}, {sums}
        FROM cellday GROUP BY cell_id, conf, ym ORDER BY conf, cell_id, ym
    """)

    cells = con.execute("SELECT DISTINCT cell_id FROM cellday ORDER BY cell_id").df()
    lat, lon = grid.cell_center(cells["cell_id"].to_numpy())
    cells["lat"], cells["lon"] = lat, lon
    cells["block_id"] = grid.block_id(lat, lon).astype("int32")
    con.register("cells_df", cells)
    con.execute("CREATE TABLE cells AS SELECT * FROM cells_df ORDER BY cell_id")
    con.unregister("cells_df")

    agg = ", ".join(
        [f"sum(cd_{n})::BIGINT AS cd_{n}" for n in bits]
        + [f"sum(nd_{s})::BIGINT AS nd_{s}, sum(frp_{s})::DOUBLE AS frp_{s}" for s in SAT_COLS]
    )
    con.execute(f"""
        CREATE TABLE blockmonth AS
        SELECT c.block_id, m.conf, m.ym, {agg}
        FROM cellmonth m JOIN cells c USING (cell_id)
        GROUP BY c.block_id, m.conf, m.ym ORDER BY m.conf, c.block_id, m.ym
    """)

    # ---- meta ------------------------------------------------------------
    cov = con.execute("""
        SELECT satellite, min(acq_date), max(acq_date),
               max(acq_date) FILTER (product = 'SP'), min(acq_date) FILTER (product = 'NRT'), count(*)
        FROM det GROUP BY satellite
    """).fetchall()
    coverage = {
        sat: {
            "start": str(a), "end": str(b),
            "sp_end": str(sp) if sp else None, "nrt_start": str(nrt) if nrt else None,
            "detections": int(n),
        }
        for sat, a, b, sp, nrt, n in cov
    }
    data_start, data_end = con.execute("SELECT min(acq_date), max(acq_date) FROM det").fetchone()
    region_info = {}
    for rid, r in config.regions().items():
        w, s, e, n = r.bbox
        cnt = con.execute("SELECT count(*) FROM cells WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?", [w, e, s, n]).fetchone()[0]
        covered = any(_contains(b["bbox"], r.bbox) for b in boxes)
        region_info[rid] = {"loaded": bool(covered and cnt > 0), "cells": int(cnt)}
    meta = {
        "demo": bool(use_demo),
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "last_refresh": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_start": str(data_start),
        "data_end": str(data_end),
        "coverage": coverage,
        "coverage_boxes": boxes,
        "regions": region_info,
        "detections": int(n_det),
        "cell_days": int(con.execute("SELECT count(*) FROM cellday WHERE conf = 1").fetchone()[0]),
        "cells": int(len(cells)),
        "keep_types": config.settings()["cleaning"]["keep_types"],
        "harmonization_version": config.settings()["harmonization"]["version"],
    }
    con.execute("CREATE TABLE meta (key VARCHAR PRIMARY KEY, value VARCHAR)")
    con.executemany("INSERT INTO meta VALUES (?, ?)", [(k, json.dumps(v)) for k, v in meta.items()])
    con.execute("CHECKPOINT")
    con.close()
    target = config.db_path()
    try:
        if target.exists():
            target.unlink()
        tmp.replace(target)
    except PermissionError as exc:  # Windows: file held by a running server
        raise RuntimeError(
            f"Cannot replace {target}: it is open in another process. Stop the KELVIN server and run the build again."
        ) from exc
    shutil.rmtree(staging, ignore_errors=True)
    log(f"Built {target} ({n_det:,} detections, {meta['cell_days']:,} cell-days, {len(cells):,} cells)")
    return meta


def _contains(outer: list[float], inner: tuple[float, float, float, float]) -> bool:
    eps = 0.11
    return outer[0] <= inner[0] + eps and outer[1] <= inner[1] + eps and outer[2] >= inner[2] - eps and outer[3] >= inner[3] - eps


def set_meta(values: dict) -> None:
    """Upsert meta keys (used by calibrate and refresh)."""
    db.close()
    con = duckdb.connect(str(config.db_path()))
    for k, v in values.items():
        con.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", [k, json.dumps(v)])
    con.close()
