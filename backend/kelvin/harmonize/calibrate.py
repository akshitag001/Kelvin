"""`kelvin calibrate`: estimate the VIIRS -> MODIS-equivalent factors.

See docs/METHODOLOGY.md. In short, for each metric and confidence tier:

  k(block, season)   ratio of MODIS-any to SNPP monthly sums over the calibration
                     window, shrunk block-season -> block -> 10-degree region -> global
  90% interval       bootstrap over calibration years
  cross-validation   leave one year out, predict that year's MODIS from VIIRS
  terra factor       (Terra or Aqua) / Terra per block and calendar month, 2003-2006
  chain factors      NOAA-20 -> SNPP and NOAA-21 -> NOAA-20 over their overlaps
"""
from __future__ import annotations

from typing import Callable

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

from kelvin import config, db, grid

METRICS = {
    # metric: (modis_any, terra, snpp, n20, n21) column expressions on blockmonth
    "cells": ("cd_modis", "cd_terra", "cd_snpp", "cd_n20", "cd_n21"),
    "detections": ("nd_terra + nd_aqua", "nd_terra", "nd_snpp", "nd_n20", "nd_n21"),
    "frp": ("frp_terra + frp_aqua", "frp_terra", "frp_snpp", "frp_n20", "frp_n21"),
}
LEVELS = ["block-season", "block", "region", "global"]
MONTH_LEVELS = ["block-month", "block", "global"]


def season_of_month(month) -> np.ndarray:
    """0 = DJF, 1 = MAM, 2 = JJA, 3 = SON."""
    return (np.asarray(month) % 12) // 3


def _ratio(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.divide(a, b, out=np.zeros_like(a, dtype="float64"), where=b > 0)


def hierarchical_ratio(M: np.ndarray, V: np.ndarray, N: np.ndarray, tiles: np.ndarray, n0: float):
    """Shrunk ratio M/V per (block, stratum).

    M, V, N have shape (n_blocks, n_strata). N is the evidence (VIIRS cell-days)
    behind each ratio; the weight of a level's own ratio is N / (N + n0).
    Returns (k, level_index, global_ratio). level_index: 0 own stratum, 1 block,
    2 region (10-degree tile), 3 global.
    """
    M = np.asarray(M, dtype="float64")
    V = np.asarray(V, dtype="float64")
    N = np.asarray(N, dtype="float64")
    g = float(M.sum() / V.sum()) if V.sum() > 0 else float("nan")
    _, tinv = np.unique(tiles, return_inverse=True)
    nt = tinv.max() + 1 if tinv.size else 0
    Mb, Vb, Nb = M.sum(1), V.sum(1), N.sum(1)
    Mt, Vt, Nt = (np.bincount(tinv, weights=x, minlength=nt) for x in (Mb, Vb, Nb))
    w_t = Nt / (Nt + n0)
    k_t = w_t * _ratio(Mt, Vt) + (1 - w_t) * g
    w_b = Nb / (Nb + n0)
    k_b = w_b * _ratio(Mb, Vb) + (1 - w_b) * k_t[tinv]
    w_s = N / (N + n0)
    k = w_s * _ratio(M, V) + (1 - w_s) * k_b[:, None]
    level = np.where(w_s >= 0.5, 0, np.where(w_b[:, None] >= 0.5, 1, np.where(w_t[tinv][:, None] >= 0.5, 2, 3)))
    return k, level, g


def _trim_outlier_months(df: pd.DataFrame) -> pd.DataFrame:
    """Drop block-months whose log ratio is more than 3 robust sigmas from the block median."""
    ok = (df["V"] >= 20) & (df["M"] > 0)
    lr = np.log(df["M"].where(ok) / df["V"].where(ok))
    med = lr.groupby(df["block_id"]).transform("median")
    mad = (lr - med).abs().groupby(df["block_id"]).transform("median") * 1.4826
    outlier = ok & (mad > 0) & ((lr - med).abs() > 3 * np.maximum(mad, 0.05))
    return df[~outlier]


def cv_metrics(obs: np.ndarray, pred: np.ndarray, min_obs: float = 20.0) -> dict:
    obs = np.asarray(obs, dtype="float64")
    pred = np.asarray(pred, dtype="float64")
    out = {"n_months": int(obs.size), "mape": None, "wmape": None, "bias": None, "r2": None, "spearman": None}
    if obs.size < 3 or obs.sum() <= 0:
        return out
    big = obs >= min_obs
    if big.sum() >= 3:
        out["mape"] = float(np.mean(np.abs(pred[big] - obs[big]) / obs[big]))
    out["wmape"] = float(np.abs(pred - obs).sum() / obs.sum())
    out["bias"] = float(pred.sum() / obs.sum() - 1)
    ss_tot = float(((obs - obs.mean()) ** 2).sum())
    out["r2"] = float(1 - ((obs - pred) ** 2).sum() / ss_tot) if ss_tot > 0 else None
    if np.ptp(obs) > 0 and np.ptp(pred) > 0:
        out["spearman"] = float(stats.spearmanr(obs, pred).statistic)
    return out


def _cube(df: pd.DataFrame, blocks: np.ndarray, years: np.ndarray, col: str) -> np.ndarray:
    """(block, season, year) sums."""
    out = np.zeros((blocks.size, 4, years.size))
    bi = np.searchsorted(blocks, df["block_id"].to_numpy())
    yi = np.searchsorted(years, df["year"].to_numpy())
    np.add.at(out, (bi, df["season"].to_numpy(), yi), df[col].to_numpy(dtype="float64"))
    return out


def calibrate_one(bm: pd.DataFrame, metric: str, cfg: dict, rng: np.random.Generator) -> dict:
    """Calibrate one metric from a blockmonth frame (one confidence tier).

    bm columns: block_id, ym, M (modis any), T (terra), V (snpp), N (snpp cell-days), V20, V21.
    """
    n0 = float(cfg["shrinkage_n0"])
    ym = bm["ym"].to_numpy()
    bm = bm.assign(year=ym // 100, month=ym % 100)
    bm["season"] = season_of_month(bm["month"])
    c0 = int(cfg["calibration_start"][:4]) * 100 + int(cfg["calibration_start"][5:7])
    c1 = int(cfg["calibration_end"][:4]) * 100 + int(cfg["calibration_end"][5:7])
    win = bm[(bm["ym"] >= c0) & (bm["ym"] <= c1) & ((bm["M"] > 0) | (bm["V"] > 0))]
    res: dict = {"metric": metric, "global_k": None, "calibration": pd.DataFrame(), "cv": [], "cv_points": pd.DataFrame(),
                 "terra": pd.DataFrame(), "terra_global": None, "chain": {}}

    if not win.empty and win["V"].sum() > 0 and win["M"].sum() > 0:
        fit = _trim_outlier_months(win)
        blocks = np.sort(fit["block_id"].unique())
        years = np.sort(fit["year"].unique())
        tiles = grid.tile_of_block(blocks)
        Mc, Vc, Nc = (_cube(fit, blocks, years, c) for c in ("M", "V", "N"))
        k, level, g = hierarchical_ratio(Mc.sum(2), Vc.sum(2), Nc.sum(2), tiles, n0)
        res["global_k"] = g

        # bootstrap over years
        B = int(cfg["bootstrap_samples"]) if years.size >= 3 else 0
        alpha = (1 - float(cfg["bootstrap_interval"])) / 2
        if B:
            ks = np.empty((B,) + k.shape)
            gs = np.empty(B)
            for b in range(B):
                w = rng.multinomial(years.size, np.full(years.size, 1 / years.size)).astype("float64")
                ks[b], _, gs[b] = hierarchical_ratio(Mc @ w, Vc @ w, Nc @ w, tiles, n0)
            k_lo, k_hi = np.nanquantile(ks, alpha, axis=0), np.nanquantile(ks, 1 - alpha, axis=0)
            res["global_k_lo"], res["global_k_hi"] = float(np.nanquantile(gs, alpha)), float(np.nanquantile(gs, 1 - alpha))
        else:
            k_lo, k_hi = k.copy(), k.copy()
            res["global_k_lo"] = res["global_k_hi"] = g
        bi, si = np.meshgrid(np.arange(blocks.size), np.arange(4), indexing="ij")
        res["calibration"] = pd.DataFrame({
            "block_id": blocks[bi.ravel()].astype("int32"),
            "season": si.ravel().astype("int8"),
            "k": k.ravel(), "k_lo": np.minimum(k_lo, k).ravel(), "k_hi": np.maximum(k_hi, k).ravel(),
            "n_viirs": Nc.sum(2).ravel(), "sum_modis": Mc.sum(2).ravel(), "sum_viirs": Vc.sum(2).ravel(),
            "raw_ratio": _ratio(Mc.sum(2), Vc.sum(2)).ravel(),
            "level": np.array(LEVELS)[level.ravel()],
        })

        # leave-one-year-out: predict each year's MODIS from VIIRS with k fitted without it
        preds = []
        for yi, y in enumerate(years):
            w = np.ones(years.size)
            w[yi] = 0
            if years.size < 2:
                break
            k_y, _, _ = hierarchical_ratio(Mc @ w, Vc @ w, Nc @ w, tiles, n0)
            part = win[win["year"] == y]
            part = part[part["block_id"].isin(blocks)]
            kk = k_y[np.searchsorted(blocks, part["block_id"].to_numpy()), part["season"].to_numpy()]
            preds.append(part[["block_id", "ym", "M", "V"]].assign(P=kk * part["V"].to_numpy()))
        if preds:
            pr = pd.concat(preds, ignore_index=True)
            s_lat, w_lon = grid.block_corner(pr["block_id"].to_numpy())
            groups = {"all": np.ones(len(pr), dtype=bool)}
            for rid, r in config.regions().items():
                w, s, e, n = r.bbox
                groups[rid] = (w_lon + 0.5 >= w - 0.5) & (w_lon + 0.5 <= e + 0.5) & (s_lat + 0.5 >= s - 0.5) & (s_lat + 0.5 <= n + 0.5)
            pts = []
            for rid, mask in groups.items():
                if not mask.any():
                    continue
                series = pr[mask].groupby("ym")[["M", "V", "P"]].sum().reset_index()
                res["cv"].append({"region": rid, **cv_metrics(series["M"].to_numpy(), series["P"].to_numpy())})
                pts.append(series.assign(region=rid))
            res["cv_points"] = pd.concat(pts, ignore_index=True).rename(
                columns={"M": "modis", "V": "viirs_raw", "P": "viirs_scaled"})

    # Terra-only correction: (Terra or Aqua) / Terra by block and calendar month
    ty = cfg["terra_factor_years"]
    tw = bm[bm["year"].isin(ty) & (bm["T"] > 0)]
    if not tw.empty:
        blocks = np.sort(tw["block_id"].unique())
        Mm = np.zeros((blocks.size, 12))
        Tm = np.zeros((blocks.size, 12))
        Nm = np.zeros((blocks.size, 12))
        bi = np.searchsorted(blocks, tw["block_id"].to_numpy())
        mi = tw["month"].to_numpy() - 1
        np.add.at(Mm, (bi, mi), tw["M"].to_numpy(dtype="float64"))
        np.add.at(Tm, (bi, mi), tw["T"].to_numpy(dtype="float64"))
        np.add.at(Nm, (bi, mi), tw["NT"].to_numpy(dtype="float64"))
        f, level, fg = hierarchical_ratio(Mm, Tm, Nm, np.zeros(blocks.size, dtype=int), n0)
        level = np.minimum(level, 2)  # one tile -> region and global coincide
        bi2, mi2 = np.meshgrid(np.arange(blocks.size), np.arange(12), indexing="ij")
        res["terra"] = pd.DataFrame({
            "block_id": blocks[bi2.ravel()].astype("int32"), "month": (mi2.ravel() + 1).astype("int8"),
            "f": f.ravel(), "n": Nm.ravel(), "level": np.array(MONTH_LEVELS)[level.ravel()],
        })
        res["terra_global"] = fg

    # chain factors, global ratio of sums over each pair's overlap
    both = bm[(bm["V"] > 0) & (bm["V20"] > 0)]
    if not both.empty:
        res["chain"]["NOAA20"] = {"factor": float(both["V"].sum() / both["V20"].sum()), "to": "SNPP", "n_months": int(both["ym"].nunique())}
    both = bm[(bm["V20"] > 0) & (bm["V21"] > 0)]
    if not both.empty:
        c21 = float(both["V20"].sum() / both["V21"].sum())
        c20 = res["chain"].get("NOAA20", {}).get("factor", 1.0)
        res["chain"]["NOAA21"] = {"factor": c21 * c20, "to": "NOAA20 -> SNPP", "step": c21, "n_months": int(both["ym"].nunique())}
    return res


def load_blockmonth(con: duckdb.DuckDBPyConnection, metric: str, conf: int) -> pd.DataFrame:
    m, t, v, v20, v21 = METRICS[metric]
    return con.execute(f"""
        SELECT block_id, ym, ({m})::DOUBLE AS M, ({t})::DOUBLE AS T, ({v})::DOUBLE AS V,
               cd_snpp::DOUBLE AS N, cd_terra::DOUBLE AS NT, ({v20})::DOUBLE AS V20, ({v21})::DOUBLE AS V21
        FROM blockmonth WHERE conf = ?
    """, [conf]).df()


def calibrate(log: Callable[[str], None] = print) -> dict:
    """Fit all factors and write them into the database."""
    import json

    cfg = config.settings()["harmonization"]
    db.close()
    con = duckdb.connect(str(config.db_path()))
    rng = np.random.default_rng(1234)
    cal, terra, cvs, pts = [], [], [], []
    summary: dict = {}
    for metric in METRICS:
        for conf_name, conf in config.CONF_LEVELS.items():
            res = calibrate_one(load_blockmonth(con, metric, conf), metric, cfg, rng)
            key = f"{metric}:{conf_name}"
            summary[key] = {
                "global_k": res["global_k"], "global_k_lo": res.get("global_k_lo"), "global_k_hi": res.get("global_k_hi"),
                "terra_global": res["terra_global"], "chain": res["chain"],
            }
            for frame, bucket in ((res["calibration"], cal), (res["terra"], terra), (res["cv_points"], pts)):
                if not frame.empty:
                    bucket.append(frame.assign(metric=metric, conf=conf))
            cvs.extend({"metric": metric, "conf": conf, **row} for row in res["cv"])
            if metric == "cells" and conf == 1:
                g = res["global_k"]
                log(f"  cells / nominal confidence: global k = {g:.3f}" if g else "  no MODIS-VIIRS overlap: k not estimated")
    empty_cal = pd.DataFrame(columns=["block_id", "season", "k", "k_lo", "k_hi", "n_viirs", "sum_modis", "sum_viirs", "raw_ratio", "level", "metric", "conf"])
    empty_terra = pd.DataFrame(columns=["block_id", "month", "f", "n", "level", "metric", "conf"])
    empty_pts = pd.DataFrame(columns=["ym", "modis", "viirs_raw", "viirs_scaled", "region", "metric", "conf"])
    empty_cv = pd.DataFrame(columns=["metric", "conf", "region", "n_months", "mape", "wmape", "bias", "r2", "spearman"])
    frames = {
        "calibration": pd.concat(cal, ignore_index=True) if cal else empty_cal,
        "terra_factor": pd.concat(terra, ignore_index=True) if terra else empty_terra,
        "cv_points": pd.concat(pts, ignore_index=True) if pts else empty_pts,
        "cv": pd.DataFrame(cvs) if cvs else empty_cv,
    }
    for name, frame in frames.items():
        con.register("tmp_df", frame)
        con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM tmp_df")
        con.unregister("tmp_df")
    con.execute("INSERT OR REPLACE INTO meta VALUES ('calibration', ?)", [json.dumps({
        "factors": summary,
        "calibration_start": cfg["calibration_start"], "calibration_end": cfg["calibration_end"],
        "switch_date": cfg["switch_date"], "version": cfg["version"],
    })])
    con.execute("CHECKPOINT")
    con.close()
    log(f"Calibration stored: {len(frames['calibration']):,} block-season factors, {len(frames['cv'])} cross-validation rows")
    return summary
