"""`kelvin import-archive`: copy FIRMS Archive Download files into data/raw/manual and build.

Sensor is detected from the columns (brightness vs bright_ti4); satellite from the
`satellite` column (MODIS: Terra/Aqua) or the file name (fire_archive_SV-C2 = SNPP,
J1V = NOAA-20, J2V = NOAA-21); product from the name (archive = SP, nrt = NRT).
"""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path
from typing import Callable

import pandas as pd

from kelvin import config
from kelvin.ingest import clean


def inspect(path: Path) -> list[dict]:
    """Describe each CSV in a file or zip: sensor, satellite hint, product hint, rows sampled."""
    out = []

    def one(name: str, fh) -> None:
        head = pd.read_csv(fh, nrows=200)
        sat, prod = clean.hints_from_name(name)
        out.append({"file": name, "sensor": clean.detect_sensor(head.columns), "satellite": sat, "product": prod,
                    "columns": list(head.columns)})

    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            for m in zf.namelist():
                if m.lower().endswith(".csv"):
                    with zf.open(m) as fh:
                        one(Path(m).name, fh)
    else:
        with open(path, "rb") as fh:
            one(path.name, fh)
    return out


def run(folder: str | None, build_after: bool = True, log: Callable[[str], None] = print) -> int:
    dest = config.raw_dir() / "manual"
    dest.mkdir(parents=True, exist_ok=True)
    src = Path(folder).resolve() if folder else dest
    files = [p for p in src.rglob("*") if p.suffix.lower() in (".csv", ".zip")]
    if not files:
        log(f"No .csv or .zip files in {src}. See README: 'Bulk history via FIRMS Archive Download'.")
        return 2
    for p in files:
        try:
            for info in inspect(p):
                log(f"  {info['file']}: {info['sensor']}, satellite={info['satellite'] or 'from column'}, product={info['product'] or 'from version'}")
        except Exception as exc:
            log(f"  {p.name}: cannot read ({exc}); skipped")
            continue
        if p.parent.resolve() != dest.resolve():
            shutil.copy2(p, dest / p.name)
    if build_after:
        from kelvin.harmonize.calibrate import calibrate
        from kelvin.process.build import build

        build(use_demo=False, log=log)
        calibrate(log=log)
    return 0
