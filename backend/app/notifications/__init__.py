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
) -> list[int]:
    """Create one in-app notification per user plus simulated email (and SMS) outbox rows."""
    user_ids = list(dict.fromkeys(u for u in user_ids if u))  # unique, keep order
    if not user_ids:
        return []
    msg = render(conn, template_code, ctx)
    users = {u["id"]: u for u in conn.all("SELECT id, email, phone FROM users WHERE id = ANY(%s)", (user_ids,))}
    ids = []
    for uid in user_ids:
        nid = conn.val(
            """INSERT INTO notifications (user_id, alert_id, kind, title, body, link, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (uid, alert_id, kind, msg["subject"], msg["body"], link, now),
        )
        ids.append(nid)
        u = users[uid]
        conn.run(
            """INSERT INTO outbox (alert_id, notification_id, user_id, channel, address, subject, body, status,
                                   created_at, updated_at)
               VALUES (%s, %s, %s, 'email', %s, %s, %s, 'queued', %s, %s)""",
            (alert_id, nid, uid, u["email"], msg["subject"], msg["body"], now, now),
        )
        if sms:
            conn.run(
                """INSERT INTO outbox (alert_id, notification_id, user_id, channel, address, subject, body, status,
                                       created_at, updated_at)
                   VALUES (%s, %s, %s, 'sms', %s, '', %s, 'queued', %s, %s)""",
                (alert_id, nid, uid, u["phone"], msg["sms"], now, now),
            )
    return ids


def progress_outbox(conn: Conn, now: datetime) -> dict:
    """Advance simulated delivery by one step (sent -> delivered/failed, then queued -> sent)."""
    delivered = conn.run(
        """UPDATE outbox o SET status = 'delivered', status_reason = 'Simulated delivery receipt', updated_at = %s
           FROM users u WHERE o.user_id = u.id AND o.status = 'sent'
             AND (o.channel = 'email' OR u.phone_valid)""",
        (now,),
    )
    failed = conn.run(
        """UPDATE outbox o SET status = 'failed', status_reason = 'Simulated: number not reachable', updated_at = %s
           FROM users u WHERE o.user_id = u.id AND o.status = 'sent' AND o.channel = 'sms' AND NOT u.phone_valid""",
        (now,),
    )
    # The tick calls this before it fires new alerts, so new rows stay queued until the next tick.
    sent = conn.run(
        "UPDATE outbox SET status = 'sent', status_reason = 'Simulated hand-off to gateway', updated_at = %s "
        "WHERE status = 'queued'",
        (now,),
    )
    return {"sent": sent, "delivered": delivered, "failed": failed}


def unread_count(conn: Conn, user_id: int) -> int:
    return int(conn.val("SELECT count(*) FROM notifications WHERE user_id = %s AND read_at IS NULL", (user_id,)))
