"""Start the KELVIN backend (FastAPI on :8000) and frontend (Vite on :5173) together.

Cross-platform: run `python scripts/dev.py` from the repo root on Windows, macOS or Linux.
  --prod   build the frontend once and serve everything from one process on :8000
Ctrl+C stops both.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / "frontend"
IS_WIN = os.name == "nt"


def venv_python() -> str:
    p = ROOT / ".venv" / ("Scripts/python.exe" if IS_WIN else "bin/python")
    return str(p) if p.exists() else sys.executable


def npm() -> str:
    exe = shutil.which("npm.cmd" if IS_WIN else "npm") or shutil.which("npm")
    if not exe:
        sys.exit("npm not found. Install Node.js 20+ from https://nodejs.org/")
    return exe


def port_free(port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def pick_port(preferred: int, label: str) -> int:
    for p in range(preferred, preferred + 50):
        if port_free(p):
            if p != preferred:
                print(f"  Port {preferred} is in use by another program; {label} will use {p} instead.", flush=True)
            return p
    sys.exit(f"No free port found near {preferred} for {label}.")


def ensure_data(py: str) -> None:
    if not (ROOT / "data" / "processed" / "kelvin.duckdb").exists():
        print("No database yet: generating SYNTHETIC demo data (about 2 minutes, one time) ...", flush=True)
        subprocess.run([py, "-m", "kelvin", "demo-data"], cwd=ROOT, check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prod", action="store_true", help="build the frontend and serve from one process")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reload", action="store_true", help="restart the API when backend code changes (can be flaky on Windows)")
    args = ap.parse_args()
    py = venv_python()
    ensure_data(py)
    if not (FRONT / "node_modules").exists():
        subprocess.run([npm(), "install", "--no-audit", "--no-fund"], cwd=FRONT, check=True)

    args.port = pick_port(args.port, "the KELVIN API")
    env = {**os.environ, "PYTHONPATH": str(ROOT / "backend"), "KELVIN_API_PORT": str(args.port)}
    if args.prod:
        subprocess.run([npm(), "run", "build"], cwd=FRONT, check=True)
        print(f"\n  KELVIN running at http://127.0.0.1:{args.port}\n", flush=True)
        return subprocess.call([py, "-m", "kelvin", "serve", "--port", str(args.port)], cwd=ROOT, env=env)

    ui_port = pick_port(5173, "the web app")
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WIN else 0
    procs = [
        subprocess.Popen([py, "-m", "kelvin", "serve", "--port", str(args.port)] + (["--reload"] if args.reload else []),
                         cwd=ROOT, env=env, creationflags=flags),
        subprocess.Popen([npm(), "run", "dev", "--", "--port", str(ui_port), "--strictPort"], cwd=FRONT, env=env, creationflags=flags),
    ]
    print(f"\n  KELVIN dev servers starting\n  App:  http://localhost:{ui_port}\n  API:  http://127.0.0.1:{args.port}/docs\n  Ctrl+C to stop\n", flush=True)
    try:
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
        for name, p in zip(("API server", "frontend"), procs):
            if p.poll() is not None:
                print(f"\n  The {name} stopped (exit code {p.returncode}). See the messages above.", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            if p.poll() is None:
                if IS_WIN:
                    subprocess.call(["taskkill", "/F", "/T", "/PID", str(p.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    p.send_signal(signal.SIGINT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
