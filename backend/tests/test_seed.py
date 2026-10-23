"""Same seed, same data: regenerating the dataset reproduces the committed dump byte for byte."""

from app.data.seed import generate
from app.data.snapshot import DUMP_PATH, export_dump
from db import Conn, connect


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
