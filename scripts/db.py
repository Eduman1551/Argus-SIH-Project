"""Database commands: init (create tables), seed (load synthetic data), reset (restore the seeded snapshot).

Usage: python scripts/db.py init|seed|reset
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from db import Conn, connect, init_schema  # noqa: E402


def main(cmd: str) -> None:
    started = time.perf_counter()
    raw = connect()
    conn = Conn(raw)
    try:
        if cmd == "init":
            init_schema(conn)
            raw.commit()
            print("Tables created.")
        elif cmd == "seed":
            from app.data.seed import seed

            stats = seed(conn, progress=print)
            print("Seeded:", ", ".join(f"{k}={v}" for k, v in stats.items()))
        elif cmd == "reset":
            from app.data.snapshot import restore

            restore(conn)
            raw.commit()
            print("Demo data restored from the seeded snapshot.")
        else:
            print(__doc__)
            sys.exit(2)
    finally:
        raw.close()
    print(f"Done in {time.perf_counter() - started:.1f}s")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
