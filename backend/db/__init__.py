"""Small psycopg (v3) data-access layer. Plain SQL, dict rows, one transaction per unit of work."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.config import get_settings

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# A tiny cache of idle connections, so polling does not reconnect every 3 seconds.
# No background threads and nothing that matters: losing it only costs a reconnect.
_IDLE_MAX = 3
_IDLE_SECONDS = 30.0
_idle: list[tuple[float, psycopg.Connection]] = []
_lock = threading.Lock()


class DatabaseNotConfigured(RuntimeError):
    pass


def _url() -> str:
    url = get_settings().database_url
    if not url:
        raise DatabaseNotConfigured("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")
    return url


def _checkout() -> psycopg.Connection:
    now = time.monotonic()
    with _lock:
        while _idle:
            used, raw = _idle.pop()
            if now - used < _IDLE_SECONDS and not raw.closed:
                return raw
            raw.close()
    return connect()


def _checkin(raw: psycopg.Connection) -> None:
    if raw.closed or raw.info.transaction_status != psycopg.pq.TransactionStatus.IDLE:
        raw.close()
        return
    with _lock:
        if len(_idle) < _IDLE_MAX:
            _idle.append((time.monotonic(), raw))
            return
    raw.close()


@contextmanager
def transaction() -> Iterator[Conn]:
    """Yield a Conn inside one transaction. Commits on success, rolls back on error."""
    raw = _checkout()
    conn = Conn(raw)
    try:
        yield conn
        raw.commit()
    except BaseException:
        if not raw.closed:
            raw.rollback()
        raise
    finally:
        _checkin(raw)


def connect() -> psycopg.Connection:
    """A plain connection outside the pool (scripts and tests)."""
    return psycopg.connect(_url(), row_factory=dict_row, autocommit=False, prepare_threshold=None)


class Conn:
    """Thin wrapper with the few helpers the services need."""

    def __init__(self, raw: psycopg.Connection):
        self.raw = raw

    def all(self, sql: str, params: Any = None) -> list[dict]:
        with self.raw.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall()) if cur.description else []

    def one(self, sql: str, params: Any = None) -> dict | None:
        with self.raw.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone() if cur.description else None

    def val(self, sql: str, params: Any = None) -> Any:
        row = self.one(sql, params)
        return None if row is None else next(iter(row.values()))

    def run(self, sql: str, params: Any = None) -> int:
        with self.raw.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount

    def many(self, sql: str, rows: list) -> None:
        if rows:
            with self.raw.cursor() as cur:
                cur.executemany(sql, rows)

    def script(self, sql: str) -> None:
        """Run several statements (no parameters)."""
        self.raw.execute(sql)  # type: ignore[arg-type]

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()


def init_schema(conn: Conn) -> None:
    conn.script(SCHEMA_PATH.read_text(encoding="utf-8"))
