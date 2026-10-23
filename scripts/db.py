"""Database commands.

  init      create (or recreate) all tables, empty
  seed      load the committed synthetic dataset (data/seed.copy.gz) and take the Reset snapshot
  generate  rebuild the dataset by replaying ~300 simulated days through the engines, then write
            data/seed.copy.gz (about 25 s on a local database; slow on a remote one)
  reset     restore the seeded snapshot (same as the Reset button in the app)

Usage: python scripts/db.py init|seed|generate|reset
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from db import Conn, DatabaseNotConfigured, connect, init_schema  # noqa: E402


def main(cmd: str) -> None:
    if cmd not in ("init", "seed", "generate", "reset"):
        print(__doc__)
        sys.exit(2)
    started = time.perf_counter()
    try:
        raw = connect()
    except DatabaseNotConfigured as exc:
        print(exc)
        sys.exit(1)
    conn = Conn(raw)
    try:
        if cmd == "init":
            init_schema(conn)
            raw.commit()
            print("Tables created.")
        elif cmd == "seed":
            from app.data.seed import generate, load
            from app.data.snapshot import DUMP_PATH

            if DUMP_PATH.exists():
                stats = load(conn)
            else:
                print("No data/seed.copy.gz found, generating the dataset instead.")
                stats = generate(conn, progress=print)
            print("Loaded:", ", ".join(f"{k}={v}" for k, v in stats.items()))
        elif cmd == "generate":
            from app.data.seed import generate
            from app.data.snapshot import DUMP_PATH, export_dump

            stats = generate(conn, progress=print)
            size = export_dump(conn)
            print("Generated:", ", ".join(f"{k}={v}" for k, v in stats.items()))
            print(f"Wrote {DUMP_PATH.relative_to(DUMP_PATH.parents[1])} ({size // 1024} KB uncompressed)")
        elif cmd == "reset":
            from app.data.snapshot import restore

            restore(conn)
            raw.commit()
            print("Demo data restored from the seeded snapshot.")
    finally:
        raw.close()
    print(f"Done in {time.perf_counter() - started:.1f}s")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
