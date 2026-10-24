"""Test setup.

Tests run against a separate database: TEST_DATABASE_URL if set, otherwise DATABASE_URL with
"_test" added to the database name (created on first run if the role is allowed to). The committed
synthetic dataset is loaded once per session. Engine tests run inside a transaction that is rolled
back; API tests restore the seeded snapshot first.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import _load_dotenv  # noqa: E402

_load_dotenv(ROOT / ".env")


def _test_url() -> str | None:
    if os.environ.get("TEST_DATABASE_URL"):
        return os.environ["TEST_DATABASE_URL"]
    base = os.environ.get("DATABASE_URL")
    if not base:
        return None
    parts = urlsplit(base)
    name = parts.path.lstrip("/") or "postgres"
    if name.endswith("_test"):
        return base
    return urlunsplit(parts._replace(path=f"/{name}_test"))


def _ensure_database(url: str) -> None:
    import psycopg

    try:
        psycopg.connect(url, connect_timeout=10).close()
        return
    except psycopg.OperationalError:
        pass
    name = urlsplit(url).path.lstrip("/")
    with psycopg.connect(BASE_URL, autocommit=True, connect_timeout=10) as c:
        c.execute(f'CREATE DATABASE "{name}"')


BASE_URL = os.environ.get("DATABASE_URL", "")
TEST_URL = _test_url()
if TEST_URL:
    os.environ["DATABASE_URL"] = TEST_URL


@pytest.fixture(scope="session")
def prepared_db():
    if not TEST_URL:
        pytest.skip("DATABASE_URL is not set")
    _ensure_database(TEST_URL)
    from app.data.seed import load
    from db import Conn, connect

    raw = connect()
    load(Conn(raw))
    raw.close()
    return TEST_URL


@pytest.fixture
def conn(prepared_db):
    """A connection inside a transaction that is rolled back after the test."""
    from db import Conn, connect

    raw = connect()
    c = Conn(raw)
    try:
        yield c
    finally:
        raw.rollback()
        raw.close()


@pytest.fixture
def fresh_db(prepared_db):
    """Restore the seeded snapshot (committed) for tests that go through the API, before and after the test,
    so committed changes such as a clock advance never leak into later tests."""
    from app.data.snapshot import restore
    from db import Conn, connect

    def _restore():
        raw = connect()
        restore(Conn(raw))
        raw.commit()
        raw.close()

    _restore()
    yield prepared_db
    _restore()


def user(c, code: str) -> dict:
    row = c.one("SELECT * FROM users WHERE code = %s", (code,))
    assert row, code
    return row
