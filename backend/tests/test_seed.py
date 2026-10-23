"""Same seed, same data: regenerating the dataset reproduces the committed dump byte for byte.

Regenerating replays ~300 simulated days (about 34k queries), which takes ~20 s on a local
database but far longer over the internet, so it runs only against a local database or when
ARGUS_SLOW_TESTS=1 is set.
"""

import os
from urllib.parse import urlsplit

import pytest

from app.data.seed import generate
from app.data.snapshot import DUMP_PATH, export_dump
from db import Conn, connect

_host = urlsplit(os.environ.get("DATABASE_URL", "")).hostname or ""
_local = _host in ("localhost", "127.0.0.1", "::1")


@pytest.mark.skipif(not _local and os.environ.get("ARGUS_SLOW_TESTS") != "1",
                    reason="slow over a remote database; set ARGUS_SLOW_TESTS=1 to run it")
def test_dataset_is_deterministic(prepared_db, tmp_path):
    raw = connect()
    try:
        c = Conn(raw)
        counts = generate(c, progress=lambda *_: None)
        out = tmp_path / "seed.copy.gz"
        export_dump(c, out)
    finally:
        raw.close()
    assert counts["applications"] == 60 and counts["institutions"] == 40
    assert out.read_bytes() == DUMP_PATH.read_bytes()
