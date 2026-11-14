"""FIRMS API client: probe, tiled + windowed downloads, resumable, rate-limit aware.

URL pattern (FIRMS area API):
  https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{w,s,e,n}/{DAY_RANGE}/{YYYY-MM-DD}
DAY_RANGE is 1..5 (the date is the first day of the window). Coverage per source
comes from /api/data_availability/csv/{MAP_KEY}/ALL, so nothing is hard-coded.
Key usage: /mapserver/mapkey_status/?MAP_KEY=... (about 5000 transactions / 10 min).
"""
from __future__ import annotations

import io
import json
import math
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from typing import Callable

import httpx
import pandas as pd

from kelvin import config

BASE = "https://firms.modaps.eosdis.nasa.gov"


class Firms:
    def __init__(self, key: str, timeout: float | None = None):
        cfg = config.settings()["fetch"]
        self.key = key
        self.retries = int(cfg["max_retries"])
        self.client = httpx.Client(base_url=BASE, timeout=timeout or float(cfg["timeout_seconds"]),
                                   headers={"User-Agent": "KELVIN/1.0 (NASA Space Apps 2026)"})
        self._pause_until = 0.0
        self._lock = threading.Lock()

    def _get(self, path: str) -> str:
        delay = 2.0
        for attempt in range(self.retries + 1):
            wait = self._pause_until - time.time()
            if wait > 0:
                time.sleep(wait)
            try:
                r = self.client.get(path)
                body = r.text
                if r.status_code == 429 or "exceeding allowed transaction limit" in body.lower():
                    with self._lock:  # back off every worker together
                        self._pause_until = max(self._pause_until, time.time() + 60 * (attempt + 1))
                    continue
                if r.status_code >= 500:
                    raise httpx.HTTPStatusError("server error", request=r.request, response=r)
                if r.status_code != 200:
                    raise RuntimeError(f"FIRMS returned HTTP {r.status_code}: {body[:200]}")
                if body.lstrip().lower().startswith("invalid"):
                    raise RuntimeError(f"FIRMS rejected the request: {body[:200]}")
                return body
            except (httpx.TransportError, httpx.HTTPStatusError):
                if attempt == self.retries:
                    raise
                time.sleep(delay + random.random())
                delay = min(delay * 2, 60)
        raise RuntimeError(f"FIRMS: gave up after {self.retries} retries on {path.split('/')[4] if '/' in path else path}")

    def availability(self) -> pd.DataFrame:
        return pd.read_csv(io.StringIO(self._get(f"/api/data_availability/csv/{self.key}/ALL")))

    def key_status(self) -> dict:
        try:
            return json.loads(self._get(f"/mapserver/mapkey_status/?MAP_KEY={self.key}"))
        except (ValueError, RuntimeError) as exc:
            return {"error": str(exc)}

    def area(self, source: str, bbox: tuple[float, float, float, float], start: date, days: int) -> str:
        b = ",".join(f"{v:g}" for v in bbox)
        return self._get(f"/api/area/csv/{self.key}/{source}/{b}/{days}/{start.isoformat()}")


def tiles(bbox: tuple[float, float, float, float], size: float) -> list[tuple[float, float, float, float]]:
    w, s, e, n = bbox
    nx, ny = max(1, math.ceil((e - w) / size)), max(1, math.ceil((n - s) / size))
    dx, dy = (e - w) / nx, (n - s) / ny
    return [(round(w + i * dx, 4), round(s + j * dy, 4), round(w + (i + 1) * dx, 4), round(s + (j + 1) * dy, 4))
            for i in range(nx) for j in range(ny)]


def windows(start: date, end: date, days: int) -> list[tuple[date, int]]:
    out, d = [], start
    while d <= end:
        n = min(days, (end - d).days + 1)
        out.append((d, n))
        d += timedelta(days=n)
    return out


def _avail_ranges(av: pd.DataFrame) -> dict[str, tuple[date, date]]:
    av.columns = [c.strip().lower() for c in av.columns]
    out = {}
    for r in av.itertuples(index=False):
        d = r._asdict()
        out[str(d["data_id"]).strip()] = (date.fromisoformat(str(d["min_date"])[:10]), date.fromisoformat(str(d["max_date"])[:10]))
    return out


def probe(log: Callable[[str], None] = print) -> int:
    """Check the key, list availability, sample columns; write docs/DATA_SOURCES_PROBE.json."""
    f = Firms(config.map_key() or "")
    status = f.key_status()
    log(f"Key status: {status}")
    av = _avail_ranges(f.availability())
    for k, (a, b) in sorted(av.items()):
        log(f"  {k:<20} {a} .. {b}")
    cols = {}
    sample_box = config.regions()["punjab_haryana"].bbox
    for src in ("MODIS_NRT", "VIIRS_SNPP_NRT"):
        if src in av:
            txt = f.area(src, sample_box, av[src][1] - timedelta(days=4), 5)
            cols[src] = txt.splitlines()[0].split(",") if txt.strip() else []
            log(f"  {src} columns: {cols[src]}")
    out = config.ROOT / "docs" / "DATA_SOURCES_PROBE.json"
    out.write_text(json.dumps({"probed": date.today().isoformat(), "key_status": status,
                               "availability": {k: [str(a), str(b)] for k, (a, b) in av.items()}, "columns": cols}, indent=2),
                   encoding="utf-8")
    log(f"Wrote {out}")
    return 0


def run(region_ids: list[str] | None = None, sources: list[str] | None = None, start: str | None = None, end: str | None = None,
        max_priority: int = 0, nrt_only: bool = False, days_back: int = 15, log: Callable[[str], None] = print) -> int:
    cfg = config.settings()["fetch"]
    f = Firms(config.map_key() or "")
    av = _avail_ranges(f.availability())
    regs = config.regions()
    ids = region_ids or [rid for rid, r in sorted(regs.items(), key=lambda x: x[1].priority) if r.priority <= max_priority]
    srcs = sources or [s for s in config.SOURCES if (s.endswith("_NRT") or not nrt_only)]
    jobs: list[tuple[str, str, tuple, date, int, Path]] = []
    for rid in ids:
        reg = regs[rid]
        tsize = float(cfg["tile_degrees"]) * (2 if reg.priority >= 2 else 1)
        for src in srcs:
            if src not in av:
                log(f"  {src}: not offered by FIRMS right now, skipped")
                continue
            a, b = av[src]
            if src.endswith("_NRT"):
                sp = src.replace("_NRT", "_SP")
                if sp in av:  # NRT only after the last SP day
                    a = max(a, av[sp][1] + timedelta(days=1))
                if nrt_only:
                    a = max(a, b - timedelta(days=days_back))
            if start:
                a = max(a, date.fromisoformat(start))
            if end:
                b = min(b, date.fromisoformat(end))
            for t in tiles(reg.bbox, tsize):
                for d, n in windows(a, b, int(cfg["day_range"])):
                    path = config.raw_dir() / src / rid / f"{'_'.join(f'{v:g}' for v in t)}" / f"{d.isoformat()}_{n}.csv"
                    if path.exists() and not (nrt_only or d + timedelta(days=n) > b - timedelta(days=2)):
                        continue  # resumable: completed chunks are skipped (recent ones refetched)
                    jobs.append((rid, src, t, d, n, path))
    log(f"{len(jobs):,} chunks to download for {', '.join(ids)} with {cfg['workers']} workers")
    if not jobs:
        return 0
    done, failed, rows, t0 = 0, 0, 0, time.time()

    def work(job):
        rid, src, t, d, n, path = job
        txt = f.area(src, t, d, n)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_text(txt, encoding="utf-8")
        tmp.replace(path)
        return max(0, txt.count("\n") - 1)

    with ThreadPoolExecutor(max_workers=int(cfg["workers"])) as ex:
        futs = {ex.submit(work, j): j for j in jobs}
        for fut in as_completed(futs):
            try:
                rows += fut.result()
                done += 1
            except Exception as exc:  # keep going; failed chunks are retried on the next run
                failed += 1
                j = futs[fut]
                log(f"  failed {j[1]} {j[0]} {j[3]}: {exc}")
            if (done + failed) % 200 == 0 or done + failed == len(jobs):
                rate = (done + failed) / max(time.time() - t0, 1)
                eta = (len(jobs) - done - failed) / max(rate, 1e-6)
                log(f"  {done + failed:,}/{len(jobs):,} chunks, {rows:,} rows, {failed} failed, ETA {eta / 60:.0f} min")
    log("Fetch finished. Run `python -m kelvin build` to process." + (" Re-run fetch to retry failed chunks." if failed else ""))
    return 1 if failed else 0
