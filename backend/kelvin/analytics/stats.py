"""Pure statistics used by the analytics endpoints. No I/O; easy to test."""
from __future__ import annotations

import math

import numpy as np
from scipy import stats as sps

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
CLASS_LABELS = {
    "record_high": "Record high",
    "much_above": "Much above normal",
    "above": "Above normal",
    "normal": "Normal",
    "below": "Below normal",
    "much_below": "Much below normal",
    "record_low": "Record low",
    "no_baseline": "No baseline",
}


def percentile_rank(x: float, ref: np.ndarray) -> float | None:
    """Mid-rank empirical percentile of x within ref, 0..100."""
    ref = np.asarray(ref, dtype="float64")
    ref = ref[~np.isnan(ref)]
    if ref.size == 0 or x is None or math.isnan(x):
        return None
    return float((np.sum(ref < x) + 0.5 * np.sum(ref == x)) / ref.size * 100)


def anomaly(x: float, ref) -> dict:
    """Compare x with a reference sample (same calendar month, baseline years, own year excluded)."""
    ref = np.asarray(ref, dtype="float64")
    ref = ref[~np.isnan(ref)]
    out = {"median": None, "ratio": None, "percentile": None, "z": None, "cls": "no_baseline", "n": int(ref.size)}
    if ref.size < 3 or x is None or (isinstance(x, float) and math.isnan(x)):
        return out
    med = float(np.median(ref))
    mad = float(np.median(np.abs(ref - med)))
    pct = percentile_rank(x, ref)
    out.update(median=med, percentile=pct)
    if med > 0:
        out["ratio"] = float(x / med)
    if mad > 0:
        out["z"] = float((x - med) / (1.4826 * mad))
    p10, p25, p75, p90 = np.percentile(ref, [10, 25, 75, 90])
    if ref.size >= 5 and x > ref.max():
        cls = "record_high"
    elif ref.size >= 5 and x < ref.min():
        cls = "record_low"
    elif x > p90:
        cls = "much_above"
    elif x > p75:
        cls = "above"
    elif x < p10:
        cls = "much_below"
    elif x < p25:
        cls = "below"
    else:
        cls = "normal"
    out["cls"] = cls
    return out


def envelope(values) -> dict | None:
    v = np.asarray(values, dtype="float64")
    v = v[~np.isnan(v)]
    if v.size == 0:
        return None
    q = np.percentile(v, [0, 10, 25, 50, 75, 90, 100])
    return {"min": float(q[0]), "p10": float(q[1]), "p25": float(q[2]), "median": float(q[3]),
            "p75": float(q[4]), "p90": float(q[5]), "max": float(q[6]), "mean": float(v.mean()), "n": int(v.size)}


def fire_season(monthly_mean: list[float], share: float = 0.70) -> dict:
    """Smallest contiguous (wrapping) run of months holding at least `share` of the annual total."""
    m = np.asarray(monthly_mean, dtype="float64")
    total = m.sum()
    if total <= 0:
        return {"months": [], "share": 0.0, "start": None, "end": None}
    for length in range(1, 13):
        best, best_start = -1.0, 0
        for start in range(12):
            s = sum(m[(start + i) % 12] for i in range(length))
            if s > best:
                best, best_start = s, start
        if best / total >= share:
            months = [(best_start + i) % 12 + 1 for i in range(length)]
            return {"months": months, "share": float(best / total), "start": months[0], "end": months[-1]}
    return {"months": list(range(1, 13)), "share": 1.0, "start": 1, "end": 12}


def mann_kendall(y) -> dict:
    """Mann-Kendall trend test with tie correction (normal approximation)."""
    y = np.asarray(y, dtype="float64")
    n = y.size
    if n < 4:
        return {"s": None, "tau": None, "p": None}
    s = 0.0
    for i in range(n - 1):
        s += np.sign(y[i + 1:] - y[i]).sum()
    _, counts = np.unique(y, return_counts=True)
    ties = (counts * (counts - 1) * (2 * counts + 5)).sum()
    var = (n * (n - 1) * (2 * n + 5) - ties) / 18.0
    if var <= 0:
        return {"s": float(s), "tau": 0.0, "p": 1.0}
    z = (s - np.sign(s)) / math.sqrt(var)
    p = float(2 * (1 - sps.norm.cdf(abs(z))))
    return {"s": float(s), "tau": float(s / (0.5 * n * (n - 1))), "p": p}


def trend(years: list[int], totals: list[float]) -> dict:
    """Theil-Sen slope and Mann-Kendall p-value, with deliberately cautious wording."""
    out = {"slope": None, "intercept": None, "slope_pct": None, "p": None, "tau": None, "n": len(years),
           "direction": "none", "wording": "Not enough complete years to assess a trend."}
    if len(years) < 5:
        return out
    x = np.asarray(years, dtype="float64")
    y = np.asarray(totals, dtype="float64")
    slope, intercept, _, _ = sps.theilslopes(y, x)
    mk = mann_kendall(y)
    med = float(np.median(y))
    pct = float(slope / med * 100) if med > 0 else None
    out.update(slope=float(slope), intercept=float(intercept), slope_pct=pct, p=mk["p"], tau=mk["tau"])
    span = f"{int(x[0])}-{int(x[-1])}"
    rate = f"about {abs(pct):.1f}% of the median year per year" if pct is not None else f"{abs(slope):.0f} per year"
    if mk["p"] is not None and mk["p"] < 0.05 and slope != 0:
        out["direction"] = "up" if slope > 0 else "down"
        word = "an upward" if slope > 0 else "a downward"
        out["wording"] = (
            f"Annual totals show {word} tendency over {span} ({rate}; Mann-Kendall p = {mk['p']:.3f}). "
            "This describes satellite detections, not burned area or cause, and it can be shaped by a few extreme years."
        )
    elif mk["p"] is not None and mk["p"] < 0.10 and slope != 0:
        out["direction"] = "weak_up" if slope > 0 else "weak_down"
        word = "upward" if slope > 0 else "downward"
        out["wording"] = (
            f"There is a weak {word} tendency over {span} ({rate}; p = {mk['p']:.3f}), "
            "not strong enough to rule out chance."
        )
    else:
        p_txt = f"p = {mk['p']:.2f}" if mk["p"] is not None else "p not available"
        out["wording"] = (
            f"No statistically clear trend over {span} ({p_txt}). Year-to-year variability is larger than any steady change."
        )
    return out
