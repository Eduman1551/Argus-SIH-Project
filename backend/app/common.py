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
def get_user(conn: Conn, user_id: int) -> dict:
    row = conn.one("SELECT * FROM users WHERE id = %s", (user_id,))
    if row is None:
        raise NotFound("User not found.")
    return row


def institution_users(conn: Conn, institution_id: int) -> list[int]:
    return [r["id"] for r in conn.all(
        "SELECT id FROM users WHERE role = 'institution' AND institution_id = %s ORDER BY id", (institution_id,))]


def region_officers(conn: Conn, region_id: int) -> list[dict]:
    return conn.all("""SELECT * FROM users WHERE role = 'official' AND official_kind = 'regional'
                       AND rank = 1 AND region_id = %s ORDER BY id""", (region_id,))


def region_director(conn: Conn, region_id: int) -> dict | None:
    return conn.one("""SELECT * FROM users WHERE role = 'official' AND official_kind = 'regional'
                       AND rank = 2 AND region_id = %s ORDER BY id LIMIT 1""", (region_id,))


def bureau_officer(conn: Conn) -> dict | None:
    return conn.one("""SELECT * FROM users WHERE role = 'official' AND official_kind = 'bureau'
                       AND rank = 2 ORDER BY id LIMIT 1""")


def bureau_head(conn: Conn) -> dict | None:
    return conn.one("""SELECT * FROM users WHERE role = 'official' AND official_kind = 'bureau'
                       AND rank = 3 ORDER BY id LIMIT 1""")


def is_bureau(user: dict) -> bool:
    return user["role"] == "official" and user["official_kind"] == "bureau"


def can_decide(user: dict) -> bool:
    """Competent authority for recording decisions: Regional Director or Bureau officers."""
    return user["role"] == "official" and (user["rank"] or 0) >= 2
