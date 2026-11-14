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


class _Key:
    def __init__(self, value: str):
        self.value = value
        self.pause_until = 0.0
        self.calls = 0

    @property
    def tag(self) -> str:  # for logs; never print a whole key
        return f"key …{self.value[-4:]}"


class Firms:
    """FIRMS client over one or more MAP_KEYs.

    Requests rotate between keys (round robin). FIRMS meters each key at ~5000 transactions
    per 10 minutes, and one area request can cost several. Over the limit it answers
    "Invalid MAP_KEY" (HTTP 400/401) rather than 429, so every 20 calls a key's usage is
    checked; a key near its limit is rested for 60 s while the other keys carry on. Workers
    only wait when every key is resting.
    """

    def __init__(self, keys: str | list[str], timeout: float | None = None):
        cfg = config.settings()["fetch"]
        vals = [keys] if isinstance(keys, str) else list(keys)
        self.keys = [_Key(k) for k in vals if k]
        if not self.keys:
            raise RuntimeError("No FIRMS MAP_KEY configured.")
        self.retries = int(cfg["max_retries"])
        self.client = httpx.Client(base_url=BASE, timeout=timeout or float(cfg["timeout_seconds"]),
                                   headers={"User-Agent": "KELVIN/1.0 (NASA Space Apps 2026)"})
        self._lock = threading.Lock()
        self._rr = 0
        self.log: Callable[[str], None] = print

    @property
    def key(self) -> str:
        return self.keys[0].value

    # ---------------------------------------------------------------- key budget
    def key_status(self, k: _Key | None = None) -> dict:
        k = k or self.keys[0]
        try:
            r = self.client.get(f"/mapserver/mapkey_status/?MAP_KEY={k.value}")
            return json.loads(r.text)
        except (ValueError, httpx.HTTPError) as exc:
            return {"error": str(exc)}

    def _usage(self, k: _Key) -> float | None:
        st = self.key_status(k)
        used, limit = st.get("current_transactions"), st.get("transaction_limit")
        if not isinstance(used, (int, float)) or not limit:
            return None
        return used / limit

    def _rest(self, k: _Key, seconds: float, why: str) -> None:
        with self._lock:
            k.pause_until = max(k.pause_until, time.time() + seconds)
        self.log(f"  {k.tag} {why}; resting it {seconds:.0f} s")

    def _pick(self) -> _Key:
        """Next key in rotation that is not resting; waits only if every key is resting."""
        while True:
            with self._lock:
                now = time.time()
                n = len(self.keys)
                for i in range(n):
                    k = self.keys[(self._rr + i) % n]
                    if k.pause_until <= now:
                        self._rr = (self._rr + i + 1) % n
                        k.calls += 1
                        check = k.calls % 20 == 0
                        break
                else:
                    wake = min(k.pause_until for k in self.keys)
                    k = None
            if k is None:
                time.sleep(max(0.5, wake - time.time()))
                continue
            if check:
                u = self._usage(k)
                if u is not None and u >= 0.85:
                    self._rest(k, 60, f"at {u:.0%} of its 10-minute budget")
                    continue
            return k

    def wait_for_budget(self, high: float = 0.5, log: Callable[[str], None] | None = None) -> None:
        """Block until at least one key is below `high` of its budget (used before a run)."""
        log = log or self.log
        while True:
            usage = [(k, self._usage(k)) for k in self.keys]
            if any(u is None or u < high for _, u in usage):
                for k, u in usage:
                    if u is not None and u >= high:
                        k.pause_until = time.time() + 60
                return
            log("  all FIRMS keys busy (" + ", ".join(f"{k.tag} {u:.0%}" for k, u in usage) + "); waiting 60 s")
            time.sleep(60)

    # ---------------------------------------------------------------- requests
    def _get(self, template: str) -> str:
        """GET a path containing '{key}'; the key is chosen per attempt."""
        delay = 2.0
        for attempt in range(self.retries + 4):
            k = self._pick()
            try:
                r = self.client.get(template.format(key=k.value))
                body = r.text
                low = body.lower()
                over = r.status_code == 429 or "exceeding allowed transaction limit" in low
                if not over and "invalid map_key" in low:
                    u = self._usage(k)  # a working key turning "invalid" = it hit its limit
                    if u is None:
                        raise RuntimeError(f"FIRMS says {k.tag} is invalid. Check FIRMS_MAP_KEY in .env.")
                    over = u >= 0.9
                    if not over:
                        raise RuntimeError(f"FIRMS rejected {k.tag}: {body[:120]}")
                if over:
                    self._rest(k, 60, "hit the transaction limit")
                    continue
                if r.status_code >= 500:
                    raise httpx.HTTPStatusError("server error", request=r.request, response=r)
                if r.status_code != 200:
                    raise RuntimeError(f"FIRMS returned HTTP {r.status_code}: {body[:200]}")
                if body.lstrip().lower().startswith("invalid"):
                    raise RuntimeError(f"FIRMS rejected the request: {body[:200]}")
                return body
            except (httpx.TransportError, httpx.HTTPStatusError):
                if attempt >= self.retries:
                    raise
                time.sleep(delay + random.random())
                delay = min(delay * 2, 60)
        raise RuntimeError("FIRMS: gave up after repeated retries")

    def availability(self) -> pd.DataFrame:
        return pd.read_csv(io.StringIO(self._get("/api/data_availability/csv/{key}/ALL")))

    def area(self, source: str, bbox: tuple[float, float, float, float], start: date, days: int) -> str:
        b = ",".join(f"{v:g}" for v in bbox)
        return self._get(f"/api/area/csv/{{key}}/{source}/{b}/{days}/{start.isoformat()}")


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
    f = Firms(config.map_keys())
    f.log = log
    for k in f.keys:
        log(f"Status of {k.tag}: {f.key_status(k)}")
    status = f.key_status()
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
    f = Firms(config.map_keys())
    f.log = log
    log(f"Using {len(f.keys)} FIRMS key(s), rotating: " + ", ".join(k.tag for k in f.keys))
    f.wait_for_budget(high=0.5, log=log)  # over the limit, FIRMS rejects even the availability call
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
