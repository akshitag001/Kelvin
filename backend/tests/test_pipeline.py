"""End-to-end tests on a synthetic database: harmonization recovery, analytics, every endpoint."""
import io
from datetime import date

import numpy as np
import pandas as pd
import pytest

PUNJAB = {"region": "punjab_haryana"}


def _summary(client, **kw):
    r = client.post("/api/aoi/summary", json={**PUNJAB, **kw})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- harmonization
def test_recovers_planted_factor(demo_db, client):
    """Calibrated k must match the planted MODIS-any / SNPP detection-probability ratio."""
    planted = demo_db["planted"]["planted"]["punjab_haryana"]["k"]
    d = client.get("/api/harmonization/diagnostics?region=punjab_haryana").json()
    by_season = {int(r["season"]): r["k"] for r in d["k_by_season"]}
    for s, k_true in planted.items():
        assert by_season[int(s)] == pytest.approx(k_true, rel=0.06), (s, by_season, planted)
    assert d["global_k_lo"] <= d["global_k"] <= d["global_k_hi"]


def test_recovers_terra_factor(demo_db, client):
    planted = demo_db["planted"]["planted"]["punjab_haryana"]["terra_factor"]
    d = client.get("/api/harmonization/diagnostics").json()
    t = pd.DataFrame(d["terra_factor"])
    mean_true = np.mean(list(planted.values()))
    assert np.average(t["f"], weights=t["n"]) == pytest.approx(mean_true, rel=0.08)


def test_step_removed(client):
    """VIIRS native jumps vs MODIS in the overlap; harmonized (scaled) VIIRS does not."""
    s = _summary(client)
    df = pd.DataFrame(s["monthly"])
    ov = df[(df["year"] >= 2013) & (df["year"] <= 2020)]
    modis, viirs, scaled = ov["modis"].sum(), ov["viirs"].sum(), ov["viirs_scaled"].sum()
    assert viirs / modis > 1.15  # the raw sensor jump
    assert scaled / modis == pytest.approx(1.0, abs=0.05)


def test_cross_validation_reported(client):
    s = _summary(client)
    cv = s["harmonization"]["cv"]
    assert cv and cv["wmape"] < 0.15 and cv["spearman"] > 0.9


def test_never_adds_sensors(client):
    s = _summary(client)
    for m in s["monthly"]:
        if m["harmonized"] is None:
            continue
        if m["source"] == "MODIS" and "estimated" not in m["flags"]:
            assert m["harmonized"] == pytest.approx(m["modis"])
        elif m["source"] == "VIIRS":
            assert m["harmonized"] == pytest.approx(m["viirs_scaled"], rel=1e-6)


def test_terra_only_flagged(client):
    s = _summary(client)
    early = [m for m in s["monthly"] if m["ym"] < "2002-08" and m["modis"]]
    assert early and all("estimated" in m["flags"] for m in early)


# ---------------------------------------------------------------- analytics
def test_seasonality_and_peak(client):
    s = _summary(client)
    assert s["seasonality"]["peak_month"] in (10, 11)
    assert len(s["seasonality"]["by_month"]) == 12


def test_month_to_date_is_partial(client):
    s = _summary(client)
    c = s["current"]
    assert c["ym"] == "2025-06" and c["days"] == 20 and not c["full_month"]
    # never compares a partial month against full months: the baseline is a cumulative 20-day value
    d = client.post("/api/aoi/daily", json={**PUNJAB, "month": "2025-06"}).json()
    assert d["to_date"]["days"] == 20
    assert d["days"][19]["cum_median"] == pytest.approx(c["median"])
    assert d["days"][20]["value"] is None


def test_partial_month_flag_and_ranking(client):
    s = _summary(client)
    last = s["monthly"][-1]
    assert "partial" in last["flags"]
    assert all(m["ym"] != last["ym"] for m in s["rankings"]["months"])
    assert len(s["rankings"]["months"]) == 10


def test_views_and_metrics(client):
    for view in ("harmonized", "modis", "viirs"):
        for metric in ("cells", "detections", "frp"):
            s = _summary(client, view=view, metric=metric)
            assert s["params"]["view"] == view
    v = _summary(client, view="viirs")
    assert all(m["value"] is None for m in v["monthly"] if m["year"] < 2012)


def test_confidence_filters_nest(client):
    a = sum(m["modis"] or 0 for m in _summary(client, confidence="all", view="modis")["monthly"])
    n = sum(m["modis"] or 0 for m in _summary(client, confidence="nominal", view="modis")["monthly"])
    h = sum(m["modis"] or 0 for m in _summary(client, confidence="high", view="modis")["monthly"])
    assert a > n > h > 0


def test_polygon_and_circle_inside_bbox(client):
    poly = {"type": "Polygon", "coordinates": [[[74, 28], [77, 28], [77, 32], [74, 32], [74, 28]]]}
    full = _summary(client)["aoi"]["cells"]
    part = client.post("/api/aoi/summary", json={"geojson": poly}).json()["aoi"]["cells"]
    circ = client.post("/api/aoi/summary", json={"point": {"lon": 75.5, "lat": 30.0, "radius_km": 60}}).json()["aoi"]["cells"]
    assert 0 < circ < part < full


def test_outside_coverage_warning(client):
    s = client.post("/api/aoi/summary", json={"bbox": [10, 10, 11, 11]}).json()
    assert s["warnings"][0]["code"] == "outside_coverage"
    assert s["current"] is None


def test_bad_requests(client):
    assert client.post("/api/aoi/summary", json={}).status_code == 422
    assert client.post("/api/aoi/summary", json={"bbox": [1, 2, 3, 4], "region": "x"}).status_code == 422
    assert client.post("/api/aoi/summary", json={"bbox": [5, 5, 1, 1]}).status_code == 422
    assert client.post("/api/aoi/summary", json={**PUNJAB, "metric": "nope"}).status_code == 422
    assert client.post("/api/aoi/daily", json={**PUNJAB, "month": "1990-01"}).status_code == 422


# ---------------------------------------------------------------- endpoints
def test_status_and_regions(client):
    st = client.get("/api/status").json()
    assert st["ready"] and st["demo"] is True and st["harmonization"]["global_k"]
    regs = {r["id"]: r for r in client.get("/api/regions").json()}
    assert regs["punjab_haryana"]["loaded"] and not regs["california"]["loaded"]


def test_leaderboard(client):
    lb = client.get("/api/leaderboard").json()
    assert lb["regions"][0]["id"] == "punjab_haryana" and lb["regions"][0]["rank"] == 1


def test_globe(client):
    g = client.get("/api/globe?limit=300").json()
    assert 0 < len(g["points"]) <= 300
    lon, lat, w, recent = g["points"][0]
    assert 73 <= lon <= 78 and 27 <= lat <= 33 and w == g["max"]
    assert g["last7"]["to"] == "2025-06-20" and g["last7"]["detections"] == sum(g["last7"]["by_satellite"].values())
    assert [r["id"] for r in g["regions"]] == ["punjab_haryana"]


def test_off_season_flag(client):
    c = _summary(client)["current"]
    assert isinstance(c["off_season"], bool)


def test_briefing(client):
    b = client.post("/api/aoi/briefing", json=PUNJAB).json()
    assert "Punjab" in b["title"] and "TREND." in b["text"] and "SYNTHETIC" in b["text"]


def test_hotspots_points_and_grid(client):
    pts = client.post("/api/aoi/hotspots", json={"bbox": [75, 30, 75.2, 30.2], "month": "2020-11"}).json()
    assert pts["mode"] == "points" and pts["count"] == len(pts["features"])
    grid = client.post("/api/aoi/hotspots", json=PUNJAB).json()
    assert grid["mode"] == "grid" and grid["count"] > 4000


def test_hotspots_csv(client):
    r = client.post("/api/aoi/hotspots.csv", json={"bbox": [75, 30, 76, 31], "start": "2020-11-01", "end": "2020-11-10"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    text = r.text
    assert text.startswith("# KELVIN hotspots export\n# SYNTHETIC DEMO DATA")
    assert "NASA does not endorse" in text
    df = pd.read_csv(io.StringIO(text), comment="#")
    for col in ("sensor", "satellite", "product", "provisional", "confidence", "frp", "cell_id"):
        assert col in df.columns
    assert len(df) > 0 and df["acq_date"].between("2020-11-01", "2020-11-10").all()
    assert df["latitude"].between(30, 31).all()
    assert set(df["confidence"]) <= {"n", "h"}  # low confidence dropped by default


def test_calendar_csv(client):
    r = client.post("/api/aoi/calendar.csv", json=PUNJAB)
    df = pd.read_csv(io.StringIO(r.text), comment="#")
    assert {"month", "harmonized", "modis_native", "viirs_native_unscaled", "percentile", "flags"} <= set(df.columns)
    assert df["month"].iloc[0] == "2000-11"
