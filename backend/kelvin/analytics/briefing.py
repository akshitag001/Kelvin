"""Deterministic, template-based plain-language briefing (no external LLM)."""
from __future__ import annotations

from kelvin.analytics.stats import MONTHS


def _fmt(v: float | None, unit: str) -> str:
    return "n/a" if v is None else f"{v:,.0f} {unit}"


def build(summary: dict, area_name: str | None = None) -> dict:
    s = summary
    unit = s["params"]["unit"]
    name = area_name or "the selected area"
    paras: list[str] = []

    c = s.get("current")
    if c:
        paras.append(f"CURRENT STANDING. {c['headline']} Baseline: {c['baseline_years'][0]}-{c['baseline_years'][1]}, "
                     f"same days of the month in each year." + (" Recent days are provisional near-real-time data." if c["provisional"] else ""))

    seas = s["seasonality"]
    if seas.get("peak_month"):
        months = seas["season"]["months"]
        window = f"{MONTHS[months[0] - 1]} to {MONTHS[months[-1] - 1]}" if len(months) > 1 else MONTHS[months[0] - 1]
        paras.append(f"SEASON. Burning in {name} typically peaks in {MONTHS[seas['peak_month'] - 1]}. "
                     f"The fire season ({window}) holds about {seas['season']['share'] * 100:.0f}% of annual activity.")

    r = s["rankings"]
    if r["months"]:
        m = r["months"][0]
        y = r["years"][0] if r["years"] else None
        line = f"RECORD. The most active month in the record was {MONTHS[m['month'] - 1]} {m['year']} ({_fmt(m['value'], unit)})"
        line += f"; the most active complete year was {y['year']} ({_fmt(y['total'], unit)})." if y else "."
        paras.append(line)

    paras.append(f"TREND. {s['trend']['wording']}")

    h = s["harmonization"]
    if h.get("k"):
        cv = h.get("cv") or {}
        q = ""
        if cv.get("wmape") is not None:
            q = (f" In leave-one-year-out validation for this region the scaled VIIRS series reproduced MODIS with "
                 f"{cv['wmape'] * 100:.0f}% weighted error and rank correlation {cv['spearman']:.2f}." if cv.get("spearman") is not None else "")
        paras.append(f"DATA. Values are MODIS-equivalent: VIIRS counts from {h['switch_date']} on are scaled by k = {h['k']:.2f} "
                     f"(90% range {h['k_lo']:.2f}-{h['k_hi']:.2f}), fitted over {h['calibration_window'][0][:4]}-{h['calibration_window'][1][:4]}.{q}")
    paras.append("CAVEATS. Hotspots are satellite detections of heat, not confirmed fires, burned area or cause. Clouds, smoke and "
                 "overpass timing hide some fires; small fires below about 1 km detection limits are missed in the MODIS years.")
    for w in s["warnings"]:
        if w["code"] in ("demo", "partial_coverage", "outside_coverage", "tiny_aoi"):
            paras.append(f"NOTE. {w['text']}")

    title = f"Burning activity briefing: {name}"
    return {"title": title, "paragraphs": paras, "text": title + "\n\n" + "\n\n".join(paras)}
