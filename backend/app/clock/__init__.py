"""The simulated platform clock.

Every rule, deadline and alert reads the current time from here (`now(conn)`), never from the
system clock. Time only moves when someone advances it, so reminders and escalations can be
demonstrated and tested day by day.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from db import Conn

IST = timezone(timedelta(hours=5, minutes=30), "IST")

# Simulated "today" of the seeded dataset (10:00 IST). Illustrative.
SEED_NOW = datetime(2026, 5, 15, 10, 0, tzinfo=IST)

MAX_ADVANCE_DAYS = 60


def now(conn: Conn) -> datetime:
    row = conn.one("SELECT sim_now FROM platform_clock WHERE id = 1")
    if row is None:
        raise RuntimeError("Platform clock is not initialised. Run `pnpm db:seed`.")
    return row["sim_now"].astimezone(IST)


def ist_date(dt: datetime) -> date:
    return dt.astimezone(IST).date()


def today(conn: Conn) -> date:
    return ist_date(now(conn))


def at_day_start(d: date) -> datetime:
    """10:00 IST on a calendar date (the simulated office day starts here)."""
    return datetime(d.year, d.month, d.day, 10, 0, tzinfo=IST)


def init_clock(conn: Conn, at: datetime) -> None:
    conn.run(
        """INSERT INTO platform_clock (id, sim_now, seed_now) VALUES (1, %s, %s)
           ON CONFLICT (id) DO UPDATE SET sim_now = EXCLUDED.sim_now, seed_now = EXCLUDED.seed_now,
                                          last_tick_sim = NULL, last_tick_wall = NULL""",
        (at, SEED_NOW),
    )


def set_now(conn: Conn, at: datetime) -> None:
    conn.run("UPDATE platform_clock SET sim_now = %s WHERE id = 1", (at,))


def state(conn: Conn) -> dict:
    row = conn.one("SELECT sim_now, seed_now, last_tick_sim FROM platform_clock WHERE id = 1")
    sim = row["sim_now"].astimezone(IST)
    seed = row["seed_now"].astimezone(IST)
    return {
        "now": sim.isoformat(),
        "today": sim.date().isoformat(),
        "seed_today": seed.date().isoformat(),
        "days_since_seed": (sim.date() - seed.date()).days,
        "last_tick": row["last_tick_sim"].astimezone(IST).isoformat() if row["last_tick_sim"] else None,
        "simulated": True,
    }


def advance(conn: Conn, days: int, actor: dict | None) -> dict:
    """Move the clock forward one day at a time, running the alert tick after each day,
    so every reminder fires on exactly the day its rule says."""
    from app.alerts import run_alert_tick  # local import: alerts depends on clock
    from app.audit import record

    if not 1 <= days <= MAX_ADVANCE_DAYS:
        raise ValueError(f"days must be between 1 and {MAX_ADVANCE_DAYS}")
    start = now(conn)
    totals = {"alerts": 0, "escalations": 0, "notifications": 0}
    # Finish the current day first, so anything created today gets its same-day reminders.
    first = run_alert_tick(conn, start)
    for k in totals:
        totals[k] += first.get(k, 0)
    for i in range(1, days + 1):
        current = start + timedelta(days=i)
        set_now(conn, current)
        result = run_alert_tick(conn, current)
        for k in totals:
            totals[k] += result.get(k, 0)
    end = now(conn)
    record(
        conn,
        at=end,
        actor=actor,
        action="clock.advanced",
        entity_type="clock",
        entity_id="1",
        details={"days": days, "from": start.date().isoformat(), "to": end.date().isoformat(), **totals},
    )
    return {"from": start.date().isoformat(), "to": end.date().isoformat(), "days": days, **totals}
