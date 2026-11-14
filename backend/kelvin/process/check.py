"""`kelvin check`: coverage and sanity checks on the built database."""
from __future__ import annotations

from typing import Callable

import pandas as pd

from kelvin import config, db


def run(summary_csv: str | None = None, log: Callable[[str], None] = print) -> int:
    if not db.exists():
        log("No database. Run `python -m kelvin demo-data` or `python -m kelvin build`.")
        return 2
    m = db.meta()
    cur = db.connect()
    problems = 0
    log(f"Database: {config.db_path()}  ({'SYNTHETIC DEMO DATA' if m.get('demo') else 'real FIRMS data'})")
    log(f"Record: {m['data_start']} .. {m['data_end']}, {m['detections']:,} detections, {m['cells']:,} cells")
    for sat, c in sorted(m.get("coverage", {}).items()):
        log(f"  {sat:<7} {c['start']} .. {c['end']}  SP to {c.get('sp_end')}  NRT from {c.get('nrt_start')}  ({c['detections']:,})")
    for rid, info in m.get("regions", {}).items():
        log(f"  region {rid:<22} {'loaded' if info['loaded'] else '-'} ({info['cells']:,} cells)")

    # 1. no negative or impossible values
    bad = cur.execute("SELECT count(*) FROM cellmonth WHERE cd_modis > cd_terra + cd_aqua OR cd_modis < greatest(cd_terra, cd_aqua)").fetchone()[0]
    if bad:
        problems += 1
        log(f"FAIL: {bad} cell-months violate MODIS-any bounds")
    # 2. confidence tiers nest
    nest = cur.execute("""SELECT count(*) FROM (SELECT conf, sum(cd_modis + cd_viirs) s FROM cellmonth GROUP BY conf) a,
                          (SELECT conf, sum(cd_modis + cd_viirs) s FROM cellmonth GROUP BY conf) b WHERE a.conf < b.conf AND a.s < b.s""").fetchone()[0]
    if nest:
        problems += 1
        log("FAIL: confidence tiers do not nest (all >= nominal >= high)")
    # 3. calibration present and plausible
    cal = m.get("calibration", {}).get("factors", {}).get("cells:nominal", {})
    k = cal.get("global_k")
    if k is None:
        log("WARN: no calibration (no MODIS-VIIRS overlap loaded)")
    elif not 0.2 < k < 2.0:
        problems += 1
        log(f"FAIL: global k = {k:.3f} is implausible")
    else:
        log(f"OK: global k (cells, nominal) = {k:.3f}  [{cal.get('global_k_lo'):.3f}, {cal.get('global_k_hi'):.3f}]")
    # 4. yearly totals, optionally against a FIRMS summary CSV
    yearly = cur.execute("""SELECT ym // 100 AS year, sum(nd_terra + nd_aqua) AS modis, sum(nd_snpp) AS snpp
                            FROM cellmonth WHERE conf = 0 GROUP BY year ORDER BY year""").df()
    log("Yearly detections (all confidence): " + ", ".join(f"{int(r.year)}: M{int(r.modis):,}/V{int(r.snpp):,}" for r in yearly.itertuples()))
    if summary_csv:
        ref = pd.read_csv(summary_csv)
        ref.columns = [c.strip().lower() for c in ref.columns]
        ycol = next((c for c in ref.columns if "year" in c), None)
        ncol = next((c for c in ref.columns if c in ("count", "fire_count", "hotspots", "total")), None)
        if ycol and ncol:
            j = yearly.merge(ref[[ycol, ncol]].rename(columns={ycol: "year", ncol: "ref"}), on="year")
            j["diff_pct"] = (j["modis"] - j["ref"]) / j["ref"] * 100
            log(j.to_string(index=False))
        else:
            log("WARN: could not find year/count columns in the summary CSV")
    # 5. region sanity: Punjab peak in Oct/Nov
    if m.get("regions", {}).get("punjab_haryana", {}).get("loaded"):
        from kelvin.analytics import aoi, summary
        s = summary.summarize(aoi.from_bbox(*config.regions()["punjab_haryana"].bbox), summary.Params())
        pk = s["seasonality"]["peak_month"]
        ok = pk in (10, 11, 4, 5)
        problems += 0 if ok else 1
        log(f"{'OK' if ok else 'FAIL'}: Punjab-Haryana peak month = {pk} (expected Oct/Nov, or Apr/May wheat season)")
    log("check passed" if problems == 0 else f"check found {problems} problem(s)")
    return 0 if problems == 0 else 1
