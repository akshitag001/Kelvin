"""DuckDB access. One read-only connection per process, one cursor per call."""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import duckdb

from kelvin import config

_lock = threading.Lock()
_con: duckdb.DuckDBPyConnection | None = None
_con_path: Path | None = None


def exists() -> bool:
    return config.db_path().exists()


def connect() -> duckdb.DuckDBPyConnection:
    """A cursor on the shared read-only connection (safe to use from any thread)."""
    global _con, _con_path
    path = config.db_path()
    with _lock:
        if _con is None or _con_path != path:
            if _con is not None:
                _con.close()
            _con = duckdb.connect(str(path), read_only=True)
            _con_path = path
        return _con.cursor()


def close() -> None:
    """Release the database file (needed on Windows before a rebuild replaces it)."""
    global _con, _con_path
    with _lock:
        if _con is not None:
            _con.close()
        _con, _con_path = None, None


def meta() -> dict[str, Any]:
    if not exists():
        return {}
    cur = connect()
    rows = cur.execute("SELECT key, value FROM meta").fetchall()
    return {k: json.loads(v) for k, v in rows}
