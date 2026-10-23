"""Shared errors and lookups used by the engines."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app.clock import IST
from db import Conn


class DomainError(Exception):
    status = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFound(DomainError):
    status = 404


class NotAllowed(DomainError):
    status = 403


class InvalidAction(DomainError):
    """An action that is not allowed in the current state (illegal transition)."""

    status = 409


class Invalid(DomainError):
    status = 422


def ensure(cond: bool, message: str, exc: type[DomainError] = InvalidAction) -> None:
    if not cond:
        raise exc(message)


def require_text(value: str | None, field: str, min_len: int = 10) -> str:
    text = (value or "").strip()
    if len(text) < min_len:
        raise Invalid(f"{field} is required (at least {min_len} characters).")
    return text


def end_of_day(d: date) -> datetime:
    """Deadlines fall at the end of a calendar day (IST)."""
    return datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=IST)


def due_after(now: datetime, days: int) -> datetime:
    return end_of_day((now.astimezone(IST) + timedelta(days=days)).date())


def fmt_date(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        value = value.astimezone(IST).date()
    return value.strftime("%d %b %Y")


# ------------------------------------------------------------------ people
# Users do not change while the app runs (there is no user management in v1), so one query per
# transaction loads them all and the helpers below read from that cache.
def users_by_id(conn: Conn) -> dict[int, dict]:
    if "users" not in conn.cache:
        conn.cache["users"] = {u["id"]: u for u in conn.all("SELECT * FROM users ORDER BY id")}
    return conn.cache["users"]


def get_user(conn: Conn, user_id: int) -> dict:
    row = users_by_id(conn).get(user_id)
    if row is None:
        raise NotFound("User not found.")
    return row


def _officials(conn: Conn, kind: str, rank: int, region_id: int | None = None) -> list[dict]:
    return [u for u in users_by_id(conn).values()
            if u["role"] == "official" and u["official_kind"] == kind and u["rank"] == rank
            and (region_id is None or u["region_id"] == region_id)]


def institution_users(conn: Conn, institution_id: int) -> list[int]:
    return [u["id"] for u in users_by_id(conn).values()
            if u["role"] == "institution" and u["institution_id"] == institution_id]


def region_officers(conn: Conn, region_id: int) -> list[dict]:
    return _officials(conn, "regional", 1, region_id)


def region_director(conn: Conn, region_id: int) -> dict | None:
    return next(iter(_officials(conn, "regional", 2, region_id)), None)


def bureau_officer(conn: Conn) -> dict | None:
    return next(iter(_officials(conn, "bureau", 2)), None)


def bureau_head(conn: Conn) -> dict | None:
    return next(iter(_officials(conn, "bureau", 3)), None)


def is_bureau(user: dict) -> bool:
    return user["role"] == "official" and user["official_kind"] == "bureau"


def can_decide(user: dict) -> bool:
    """Competent authority for recording decisions: Regional Director or Bureau officers."""
    return user["role"] == "official" and (user["rank"] or 0) >= 2
