"""Small psycopg (v3) data-access layer. Plain SQL, dict rows, one transaction per unit of work."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

_pool: ConnectionPool | None = None


class DatabaseNotConfigured(RuntimeError):
    pass


def _url() -> str:
    url = get_settings().database_url
    if not url:
        raise DatabaseNotConfigured("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")
    return url


def pool() -> ConnectionPool:
    # A small pool per process. On serverless each instance keeps at most a few connections;
    # nothing that matters lives here, it is only a cache of open sockets.
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            _url(),
            min_size=0,
            max_size=4,
            kwargs={"row_factory": dict_row, "autocommit": False, "prepare_threshold": None},
            check=ConnectionPool.check_connection,
            open=True,
        )
    return _pool


@contextmanager
def transaction() -> Iterator[Conn]:
    """Yield a Conn inside one transaction. Commits on success, rolls back on error."""
    with pool().connection() as raw:
        conn = Conn(raw)
        try:
            yield conn
            raw.commit()
        except BaseException:
            raw.rollback()
            raise


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
