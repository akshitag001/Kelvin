import json
import os
from datetime import date

import pytest


@pytest.fixture(scope="session")
def demo_db(tmp_path_factory):
    """Build a one-region synthetic database in a temp folder (never touches ./data)."""
    root = tmp_path_factory.mktemp("kelvin_data")
    os.environ["KELVIN_DATA_DIR"] = str(root)
    from kelvin import db
    from kelvin.harmonize.calibrate import calibrate
    from kelvin.ingest import demo
    from kelvin.process.build import build

    db.close()
    demo.generate(end=date(2025, 6, 20), region_ids=["punjab_haryana"], seed=7)
    build(use_demo=True, log=lambda *_: None)
    calibrate(log=lambda *_: None)
    planted = json.loads((root / "raw" / "demo" / "planted.json").read_text())
    yield {"root": root, "planted": planted}
    db.close()


@pytest.fixture(scope="session")
def client(demo_db):
    from fastapi.testclient import TestClient

    from kelvin.api.app import app

    return TestClient(app)
