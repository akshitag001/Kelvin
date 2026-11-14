"""One command for the pilot regions: probe FIRMS, download P0 regions, build, calibrate, check.

    python scripts/pilot_fetch.py              # P0 regions (Punjab-Haryana, Uttarakhand, Odisha)
    python scripts/pilot_fetch.py --priority 1 # also California, SE Australia, India

Resumable: re-run after an interruption and finished chunks are skipped.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(*args: str) -> int:
    py = str(PY) if PY.exists() else sys.executable
    print(">", "kelvin", *args, flush=True)
    return subprocess.call([py, "-m", "kelvin", *args], cwd=ROOT, env={**os.environ, "PYTHONPATH": str(ROOT / "backend")})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--priority", type=int, default=0)
    ap.add_argument("--start", help="YYYY-MM-DD, e.g. 2018-01-01 for a quicker first run")
    a = ap.parse_args()
    if run("probe") != 0:
        return 2
    fetch = ["fetch", "--priority", str(a.priority)] + (["--start", a.start] if a.start else [])
    rc = run(*fetch)
    if rc not in (0, 1):
        return rc
    run("build")
    return run("check")


if __name__ == "__main__":
    raise SystemExit(main())
