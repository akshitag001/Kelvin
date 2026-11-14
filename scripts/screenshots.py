"""Capture README screenshots of the running app with headless Edge or Chrome.

    python scripts/dev.py            # in one terminal
    python scripts/screenshots.py    # in another; writes docs/screenshots/*.png

Options: --base http://localhost:5173  --only home calendar
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "screenshots"

SHOTS = {
    # name: (path + query, width, height)
    "home": ("/", 1440, 1640),
    "calendar": ("/?r=punjab_haryana", 1440, 1180),
    "daily": ("/?r=punjab_haryana&month=2023-11", 1440, 1560),
    "seasons": ("/?r=uttarakhand&tab=seasons", 1440, 1080),
    "trends": ("/?r=punjab_haryana&tab=trends", 1440, 1240),
    "harmonization": ("/?r=punjab_haryana&tab=harmonization", 1440, 1500),
    "jukebox": ("/?r=punjab_haryana&tab=jukebox", 1440, 1180),
    "briefing": ("/?r=punjab_haryana&tab=briefing", 1440, 1100),
}

CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]


def browser() -> str:
    for c in CANDIDATES:
        if Path(c).exists():
            return c
    for name in ("msedge", "google-chrome", "chromium", "chromium-browser", "chrome"):
        if p := shutil.which(name):
            return p
    sys.exit("No Edge or Chrome found for headless screenshots.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5173")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--wait-ms", type=int, default=14000, help="virtual time for tiles and charts to settle")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    exe = browser()
    for name, (path, w, h) in SHOTS.items():
        if a.only and name not in a.only:
            continue
        target = OUT / f"{name}.png"
        with tempfile.TemporaryDirectory() as profile:
            cmd = [exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                   "--force-device-scale-factor=1", f"--user-data-dir={profile}", f"--window-size={w},{h}",
                   f"--virtual-time-budget={a.wait_ms}", f"--screenshot={target}", a.base + path]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        print(f"{'ok ' if target.exists() else 'FAILED'} {target.relative_to(ROOT)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
