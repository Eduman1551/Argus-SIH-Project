"""In-app notifications and the simulated email / SMS delivery log (outbox).

Nothing is really sent in v1. Outbox rows move queued -> sent -> delivered (or failed, for users
whose phone number is marked unreachable in the synthetic data) each time the alert tick runs.
"""

from __future__ import annotations

from datetime import datetime

from app.rules import template
from db import Conn


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def render(conn: Conn, code: str, ctx: dict) -> dict:
    t = template(conn, code)
    data = _SafeDict({k: ("" if v is None else v) for k, v in ctx.items()})
    return {
        "subject": t["subject"].format_map(data),
        "body": t["body"].format_map(data),
        "sms": t["sms"].format_map(data)[:160],
    }


def notify(
    conn: Conn,
    *,
    now: datetime,
    user_ids: list[int],
    template_code: str,
    ctx: dict,
    link: str | None,
    kind: str,
    alert_id: int | None = None,
    sms: bool = False,
) -> int:
    """Create one in-app notification per user plus simulated email (and SMS) outbox rows.
    The inserts are queued (no result needed) and go out with the next database round trip."""
    from app.common import users_by_id

    user_ids = list(dict.fromkeys(u for u in user_ids if u))  # unique, keep order
    if not user_ids:
        return 0
    msg = render(conn, template_code, ctx)
    users = users_by_id(conn)
    for uid in user_ids:
        u = users[uid]
        channels = [("email", u["email"], msg["subject"], msg["body"])]
        if sms:
            channels.append(("sms", u["phone"], "", msg["sms"]))
        values = ", ".join(["(%s::text, %s::text, %s::text, %s::text)"] * len(channels))
        conn.defer(
            f"""WITH n AS (INSERT INTO notifications (user_id, alert_id, kind, title, body, link, created_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id)
                INSERT INTO outbox (alert_id, notification_id, user_id, channel, address, subject, body, status,
                                    created_at, updated_at)
                SELECT %s::int, n.id, %s::int, ch.channel, ch.address, ch.subject, ch.body, 'queued',
                       %s::timestamptz, %s::timestamptz
                FROM n, (VALUES {values}) AS ch(channel, address, subject, body)""",
            (uid, alert_id, kind, msg["subject"], msg["body"], link, now,
             alert_id, uid, now, now, *[v for ch in channels for v in ch]),
        )
    return len(user_ids)


def progress_outbox(conn: Conn, now: datetime) -> dict:
    """Advance simulated delivery by one step (sent -> delivered/failed, and queued -> sent).
    Both updates read the same snapshot, so a row moves at most one step per tick. The tick calls
    this before it fires new alerts, so new rows stay queued until the next tick."""
    row = conn.one(
        """WITH d AS (
               UPDATE outbox o
                  SET status = CASE WHEN o.channel = 'sms' AND NOT u.phone_valid THEN 'failed' ELSE 'delivered' END,
                      status_reason = CASE WHEN o.channel = 'sms' AND NOT u.phone_valid
                                           THEN 'Simulated: number not reachable' ELSE 'Simulated delivery receipt' END,
                      updated_at = %(now)s
                 FROM users u WHERE o.user_id = u.id AND o.status = 'sent'
               RETURNING o.status),
           s AS (
               UPDATE outbox SET status = 'sent', status_reason = 'Simulated hand-off to gateway', updated_at = %(now)s
                WHERE status = 'queued' RETURNING 1)
           SELECT (SELECT count(*) FROM s) AS sent,
                  (SELECT count(*) FROM d WHERE status = 'delivered') AS delivered,
                  (SELECT count(*) FROM d WHERE status = 'failed') AS failed""",
        {"now": now},
    )
    return {"sent": row["sent"], "delivered": row["delivered"], "failed": row["failed"]}


def unread_count(conn: Conn, user_id: int) -> int:
    return int(conn.val("SELECT count(*) FROM notifications WHERE user_id = %s AND read_at IS NULL", (user_id,)))
