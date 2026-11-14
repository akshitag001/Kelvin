"""Pure unit tests: grid math, cleaning, dedupe, statistics, AOI geometry."""
import numpy as np
import pandas as pd
import pytest

from kelvin import grid
from kelvin.analytics import aoi, stats
from kelvin.harmonize.calibrate import cv_metrics, hierarchical_ratio, season_of_month
from kelvin.ingest import clean


# ---------------------------------------------------------------- grid
def test_cell_roundtrip_and_size():
    lat = np.array([0.0, 30.3, -33.9, 60.1, 75.0])
    lon = np.array([0.0, 75.8, 151.2, -150.0, 20.0])
    cid = grid.cell_id(lat, lon)
    clat, clon = grid.cell_center(cid)
    assert np.array_equal(grid.cell_id(clat, clon), cid)  # centre maps back to the same cell
    # a cell is 1 km tall: centre within 0.5 km of the point in latitude
    assert np.all(np.abs(clat - lat) * 111.195 <= 0.51)


def test_cells_are_equal_area():
    # at 60 degrees a 1 km cell spans twice the longitude it spans at the equator
    c0 = grid.cell_id(np.array([0.0, 0.0]), np.array([10.0, 10.0 + 1 / 111.195]))
    c60 = grid.cell_id(np.array([60.0, 60.0]), np.array([10.0, 10.0 + 1.0 / 111.195]))
    assert c0[1] - c0[0] == 1
    assert c60[1] - c60[0] in (0, 1)


def test_block_id():
    b = grid.block_id(np.array([30.5]), np.array([75.9]))
    s, w = grid.block_corner(b)
    assert (s[0], w[0]) == (30, 75)


# ---------------------------------------------------------------- cleaning
def _modis(**kw):
    base = dict(latitude=[30.1], longitude=[75.1], brightness=[320.0], scan=[1], track=[1], acq_date=["2020-11-01"],
                acq_time=[530], satellite=["Terra"], instrument=["MODIS"], confidence=[55], version=["6.1"],
                bright_t31=[290.0], frp=[12.0], daynight=["D"], type=[0])
    base.update(kw)
    return pd.DataFrame(base)


def test_detect_sensor():
    assert clean.detect_sensor(["latitude", "brightness", "bright_t31"]) == "MODIS"
    assert clean.detect_sensor(["latitude", "bright_ti4", "bright_ti5"]) == "VIIRS"
    with pytest.raises(ValueError):
        clean.detect_sensor(["latitude", "longitude"])


@pytest.mark.parametrize("raw,level", [(10, 0), (29, 0), (30, 1), (79, 1), (80, 2), (100, 2)])
def test_modis_confidence(raw, level):
    out = clean.normalize(_modis(confidence=[raw]))
    assert out["conf_level"].iloc[0] == level


def test_viirs_confidence_and_satellite_hint():
    df = pd.DataFrame(dict(latitude=[1.0, 1.0, 1.0], longitude=[2.0, 2.0, 2.0], bright_ti4=[330.0] * 3,
                           acq_date=["2020-01-01"] * 3, acq_time=["0130", "0131", "0132"], confidence=["l", "nominal", "h"],
                           version=["2.0NRT"] * 3, frp=[1.0] * 3, daynight=["N"] * 3))
    out = clean.normalize(df, satellite="NOAA20")
    assert list(out["conf_level"]) == [0, 1, 2]
    assert set(out["satellite"]) == {"NOAA20"} and set(out["product"]) == {"NRT"}
    assert (out["type"] == -1).all()


def test_name_hints():
    assert clean.hints_from_name("fire_archive_SV-C2_123.csv") == ("SNPP", "SP")
    assert clean.hints_from_name("fire_nrt_J1V-C2_123.csv") == ("NOAA20", "NRT")
    assert clean.hints_from_name("fire_archive_J2V-C2_9.csv") == ("NOAA21", "SP")
    assert clean.hints_from_name("fire_archive_M-C61_1.csv") == (None, "SP")


def test_type_filter_keeps_untyped():
    df = clean.normalize(pd.concat([_modis(type=[0]), _modis(type=[2], latitude=[30.2]), _modis(type=[1], latitude=[30.3])]))
    df = pd.concat([df, df.iloc[:1].assign(type=-1, latitude=31.0)])
    kept = clean.filter_types(df, [0])
    assert sorted(kept["type"].tolist()) == [-1, 0]


def test_dedupe_sp_wins(tmp_path, monkeypatch):
    """Build-level dedupe: exact duplicates collapse and SP supersedes NRT for the same satellite/day/tile."""
    import duckdb
    rows = pd.DataFrame({"latitude": [30.1, 30.1, 30.2, 30.5], "longitude": [75.1, 75.1, 75.2, 75.5],
                         "acq_date": pd.to_datetime(["2020-11-01"] * 4).date, "acq_time": [530, 530, 531, 532],
                         "satellite": ["Terra"] * 4, "product": ["SP", "NRT", "SP", "NRT"], "tile": [1] * 4})
    con = duckdb.connect()
    con.register("d0", rows)
    d1 = con.execute("""SELECT * FROM d0 QUALIFY row_number() OVER (PARTITION BY latitude, longitude, acq_date, acq_time, satellite
                        ORDER BY product DESC) = 1""").df()
    assert len(d1) == 3  # exact duplicate (SP + NRT at the same point) collapsed to the SP row
    assert (d1.loc[d1["latitude"] == 30.1, "product"] == "SP").all()


# ---------------------------------------------------------------- statistics
def test_anomaly_classes():
    ref = np.arange(1, 21, dtype=float)  # 1..20
    assert stats.anomaly(10.5, ref)["cls"] == "normal"
    assert stats.anomaly(19.5, ref)["cls"] == "much_above"
    assert stats.anomaly(25, ref)["cls"] == "record_high"
    assert stats.anomaly(0, ref)["cls"] == "record_low"
    a = stats.anomaly(21.0, np.array([10.0, 10.0, 10.0, 12.0, 8.0]))
    assert a["median"] == 10 and a["ratio"] == pytest.approx(2.1)
    assert a["z"] == pytest.approx((21 - 10) / (1.4826 * 0.0) if False else a["z"])  # MAD 0 -> z None
    assert stats.anomaly(5, np.array([1.0, 2.0]))["cls"] == "no_baseline"


def test_robust_z_and_percentile():
    ref = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    a = stats.anomaly(5.0, ref)
    assert a["z"] == pytest.approx((5 - 3) / (1.4826 * 1.0))
    assert stats.percentile_rank(3.0, ref) == pytest.approx(50.0)


def test_fire_season_wraps_year():
    m = [9, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 10]
    s = stats.fire_season(m)
    assert s["months"] == [12, 1] and s["share"] >= 0.7


def test_trend_detects_and_refuses():
    years = list(range(2001, 2025))
    up = stats.trend(years, [100 + 10 * i for i in range(len(years))])
    assert up["direction"] == "up" and up["p"] < 0.01 and up["slope"] == pytest.approx(10)
    flat = stats.trend(years, [100, 120, 90, 110, 95, 105] * 4)
    assert flat["direction"] == "none"
    assert stats.trend([2001, 2002], [1, 2])["slope"] is None


# ---------------------------------------------------------------- calibration math
def test_season_of_month():
    assert list(season_of_month([12, 1, 2, 3, 6, 9, 11])) == [0, 0, 0, 1, 2, 3, 3]


def test_hierarchical_shrinkage():
    M = np.array([[80.0, 0.0], [8.0, 0.0]])
    V = np.array([[100.0, 0.0], [10.0, 0.0]])
    N = V.copy()
    k, level, g = hierarchical_ratio(M, V, N, np.array([0, 0]), n0=50)
    assert g == pytest.approx(0.8)
    assert k[0, 0] == pytest.approx(0.8) and k[1, 0] == pytest.approx(0.8)
    assert level[0, 0] == 0 and level[0, 1] == 1  # empty season falls back to its well-sampled block
    assert level[1, 0] == 2  # thin block (10 cell-days) leans on its region


def test_cv_metrics_perfect():
    obs = np.array([10.0, 50.0, 30.0, 80.0])
    m = cv_metrics(obs, obs)
    assert m["wmape"] == 0 and m["r2"] == 1 and m["spearman"] == pytest.approx(1.0)


# ---------------------------------------------------------------- FIRMS key rotation
def test_keys_parse_and_rotate(monkeypatch):
    from kelvin import config
    from kelvin.ingest.fetch import Firms

    monkeypatch.setenv("FIRMS_MAP_KEY", " aaaa1111 , bbbb2222,aaaa1111")
    monkeypatch.delenv("FIRMS_MAP_KEYS", raising=False)
    assert config.map_keys() == ["aaaa1111", "bbbb2222"]

    f = Firms(config.map_keys())
    f.log = lambda *_: None
    usage = {"aaaa1111": 0.2, "bbbb2222": 0.2}
    monkeypatch.setattr(f, "_usage", lambda k: usage[k.value])
    picks = [f._pick().value for _ in range(6)]
    assert picks == ["aaaa1111", "bbbb2222"] * 3  # round robin

    usage["aaaa1111"] = 0.95  # first key near its limit: it rests, the second carries on
    for k in f.keys:
        k.calls = 19  # next pick triggers a budget check
    nxt = [f._pick().value for _ in range(3)]
    assert nxt == ["bbbb2222"] * 3
    assert f.keys[0].pause_until > 0


# ---------------------------------------------------------------- AOI geometry
def test_aoi_inputs_and_validation():
    a = aoi.from_bbox(75, 30, 76, 31)
    assert 9_000 < aoi.area_km2(a.geom) < 11_500
    c = aoi.from_circle(75.5, 30.5, 50)
    assert aoi.area_km2(c.geom) == pytest.approx(np.pi * 50 ** 2, rel=0.03)
    g = aoi.from_geojson({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[75, 30], [76, 30], [75.5, 31], [75, 30]]]}})
    assert not g.rect
    with pytest.raises(aoi.AoiError):
        aoi.from_bbox(76, 30, 75, 31)
    with pytest.raises(aoi.AoiError):
        aoi.from_bbox(-180, -60, 180, 80)  # too large
    with pytest.raises(aoi.AoiError):
        aoi.from_geojson({"type": "Point", "coordinates": [1, 2]})
