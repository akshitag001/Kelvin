"""Command line: python -m kelvin <command>. Works on Windows, macOS and Linux."""
from __future__ import annotations

import argparse
import sys
import time

from kelvin import config

NO_KEY_HELP = """\
FIRMS_MAP_KEY is not set.
  1. Get a free key (one form, arrives by email): https://firms.modaps.eosdis.nasa.gov/api/map_key/
  2. Copy .env.example to .env and set FIRMS_MAP_KEY=<your key>
Until then KELVIN runs in Demo mode on synthetic data: python -m kelvin demo-data
"""


def _log(msg: str) -> None:
    print(msg, flush=True)


def cmd_demo_data(args) -> int:
    from kelvin.harmonize.calibrate import calibrate
    from kelvin.ingest import demo
    from kelvin.process.build import build

    t0 = time.time()
    _log("Generating SYNTHETIC DEMO DATA (not real fires) ...")
    summary = demo.generate(seed=args.seed)
    _log(f"  {summary['rows']:,} synthetic rows for {', '.join(summary['regions'])}")
    build(use_demo=True, log=_log)
    calibrate(log=_log)
    _log(f"Done in {time.time() - t0:.0f} s. Start the app: python scripts/dev.py")
    return 0


def cmd_build(args) -> int:
    from kelvin.harmonize.calibrate import calibrate
    from kelvin.process.build import build

    build(use_demo=True if args.demo else None, log=_log)
    if not args.no_calibrate:
        calibrate(log=_log)
    return 0


def cmd_calibrate(args) -> int:
    from kelvin.harmonize.calibrate import calibrate

    calibrate(log=_log)
    return 0


def cmd_fetch(args) -> int:
    from kelvin.ingest import fetch

    if not config.map_key():
        _log(NO_KEY_HELP)
        return 2
    return fetch.run(region_ids=args.regions, sources=args.sources, start=args.start, end=args.end,
                     max_priority=args.priority, log=_log)


def cmd_refresh(args) -> int:
    from kelvin.harmonize.calibrate import calibrate
    from kelvin.ingest import fetch
    from kelvin.process.build import build

    if not config.map_key():
        _log(NO_KEY_HELP)
        return 2
    rc = fetch.run(region_ids=args.regions, nrt_only=True, days_back=args.days, log=_log)
    build(use_demo=False, log=_log)
    calibrate(log=_log)
    return rc


def cmd_import_archive(args) -> int:
    from kelvin.ingest import archive

    return archive.run(args.folder, build_after=not args.no_build, log=_log)


def cmd_check(args) -> int:
    from kelvin.process import check

    return check.run(summary_csv=args.yearly_summary, log=_log)


def cmd_probe(args) -> int:
    from kelvin.ingest import fetch

    if not config.map_key():
        _log(NO_KEY_HELP)
        return 2
    return fetch.probe(log=_log)


def cmd_serve(args) -> int:
    import uvicorn

    if not config.map_key():
        _log("Note: FIRMS_MAP_KEY is not set (only needed for `fetch` and `refresh`).")
    uvicorn.run("kelvin.api.app:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="kelvin", description="KELVIN: harmonized MODIS + VIIRS burning activity calendar")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("demo-data", help="generate SYNTHETIC demo data, then build and calibrate")
    s.add_argument("--seed", type=int, default=20261114)
    s.set_defaults(fn=cmd_demo_data)

    s = sub.add_parser("fetch", help="download FIRMS data for configured regions through the API")
    s.add_argument("--regions", nargs="*", help="region ids (default: by priority)")
    s.add_argument("--sources", nargs="*", help="FIRMS sources (default: all)")
    s.add_argument("--start", help="YYYY-MM-DD (default: start of each source)")
    s.add_argument("--end", help="YYYY-MM-DD (default: latest available)")
    s.add_argument("--priority", type=int, default=0, help="fetch regions with priority <= this (default 0)")
    s.set_defaults(fn=cmd_fetch)

    s = sub.add_parser("import-archive", help="import FIRMS Archive Download CSV/zip files")
    s.add_argument("folder", nargs="?", help="folder with files (default: data/raw/manual)")
    s.add_argument("--no-build", action="store_true")
    s.set_defaults(fn=cmd_import_archive)

    s = sub.add_parser("build", help="clean, grid and aggregate raw data, then calibrate")
    s.add_argument("--demo", action="store_true", help="build from the synthetic demo files")
    s.add_argument("--no-calibrate", action="store_true")
    s.set_defaults(fn=cmd_build)

    s = sub.add_parser("calibrate", help="re-estimate harmonization factors")
    s.set_defaults(fn=cmd_calibrate)

    s = sub.add_parser("refresh", help="top up recent NRT data and rebuild")
    s.add_argument("--regions", nargs="*")
    s.add_argument("--days", type=int, default=15)
    s.set_defaults(fn=cmd_refresh)

    s = sub.add_parser("check", help="coverage and sanity checks")
    s.add_argument("--yearly-summary", help="FIRMS country yearly summary CSV to compare against")
    s.set_defaults(fn=cmd_check)

    s = sub.add_parser("probe", help="probe the FIRMS API: key status, data availability, columns")
    s.set_defaults(fn=cmd_probe)

    s = sub.add_parser("serve", help="run the API (and the built frontend, if present)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--reload", action="store_true")
    s.set_defaults(fn=cmd_serve)

    args = p.parse_args(argv)
    try:
        return int(args.fn(args) or 0)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
