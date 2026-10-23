"""Alert tick: the idempotent "background worker".

`run_alert_tick(conn, now)` looks at every open item that has a deadline (stage work, deficiency
replies, EVC steps, undertakings, tracked documents), compares it with the configured reminder,
overdue and escalation rules, and writes what is due into the alerts table (the event outbox),
with notifications, simulated email/SMS rows and audit entries.

Idempotency: every alert has a unique key (entity, cycle, rule kind, offset or level). Inserts use
ON CONFLICT DO NOTHING, and only rows actually inserted produce notifications, so running the tick
any number of times never sends a duplicate. An advisory lock keeps two ticks from running at once.

It runs on /api/live polls (guarded by the last tick time), after every clock advance, and from
/api/cron/tick.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from app import notifications
from app.audit import record
from app.clock import ist_date
from app.common import (
    bureau_head,
    bureau_officer,
    fmt_date,
    institution_users,
    region_director,
    region_officers,
)
from db import Conn

TICK_LOCK = 26263
LIVE_TICK_SECONDS = 15

EVC_STEP_LABEL = """CASE v.status
    WHEN 'assignment_pending' THEN 'Assign EVC members'
    WHEN 'availability_pending' THEN 'Confirm EVC availability'
    WHEN 'date_pending' THEN 'Fix EVC visit date'
    WHEN 'scheduled' THEN 'Conduct EVC visit'
    WHEN 'report_pending' THEN 'Submit EVC visit report'
    ELSE 'Review EVC visit report' END"""

# Every open item with a deadline, one row per item and cycle.
TRACKED_ITEMS_SQL = f"""
SELECT 'stage'::text AS entity_type, s.id AS entity_id, 'stage'::text AS cycle,
       ist_date(s.due_at) AS due_date, ist_date(s.started_at) AS start_date, (s.paused_at IS NOT NULL) AS paused,
       a.id AS application_id, a.institution_id, a.region_id, a.ref_no, i.name AS institution,
       st.name AS item, s.stage_code AS detail, s.id AS stage_id
FROM application_stages s JOIN applications a ON a.id = s.application_id
JOIN institutions i ON i.id = a.institution_id JOIN stages st ON st.code = s.stage_code
WHERE s.status = 'active' AND s.stage_code <> 'evc'
UNION ALL
SELECT 'deficiency', d.id, 'reply', ist_date(d.response_due_at), ist_date(d.raised_at), false,
       a.id, a.institution_id, a.region_id, a.ref_no, i.name, 'Reply to deficiency on ' || a.ref_no, NULL, d.stage_id
FROM deficiencies d JOIN applications a ON a.id = d.application_id JOIN institutions i ON i.id = a.institution_id
WHERE d.status = 'open'
UNION ALL
SELECT 'evc_step', v.id, v.status || ':' || ist_date(v.step_due_at)::text, ist_date(v.step_due_at),
       ist_date(v.step_started_at), false, a.id, a.institution_id, a.region_id, a.ref_no, i.name,
       {EVC_STEP_LABEL}, v.status, v.stage_id
FROM evc_visits v JOIN applications a ON a.id = v.application_id JOIN institutions i ON i.id = a.institution_id
WHERE v.status IN ('assignment_pending', 'availability_pending', 'date_pending', 'scheduled', 'report_pending',
                   'report_submitted') AND v.step_due_at IS NOT NULL
UNION ALL
SELECT 'undertaking', u.id, 'u', ist_date(u.due_at),
       ist_date(GREATEST(u.created_at, (SELECT max(e.reviewed_at) FROM evidence_submissions e
                                         WHERE e.undertaking_id = u.id))), false,
       u.application_id, u.institution_id, i.region_id, a.ref_no, i.name,
       'Undertaking: ' || left(u.condition_text, 90), NULL, NULL
FROM undertakings u JOIN institutions i ON i.id = u.institution_id JOIN applications a ON a.id = u.application_id
WHERE u.status IN ('open', 'resubmission_requested')
UNION ALL
SELECT 'document', t.id, t.expires_on::text, t.expires_on,
       ist_date(GREATEST(t.tracked_since, t.verified_at, t.rejected_at)), false,
       NULL, t.institution_id, i.region_id, NULL, i.name, t.title, t.doc_type, NULL
FROM tracked_documents t JOIN institutions i ON i.id = t.institution_id
WHERE t.status IN ('valid', 'renewal_rejected')
"""

_KEY = "i.entity_type || ':' || i.entity_id || ':' || i.cycle || ':'"

REMINDER_CANDIDATES_SQL = f"""
WITH items AS ({TRACKED_ITEMS_SQL})
SELECT i.*, r.id AS rule_id, r.kind, r.offset_days, r.template_code, NULL::int AS level,
       NULL::text AS level_title, NULL::text AS target,
       GREATEST(i.due_date + r.offset_days, i.start_date, r.effective_from) AS trigger_date,
       {_KEY} || r.kind || ':' || r.offset_days AS alert_key
FROM items i JOIN reminder_rules r ON r.entity_type = i.entity_type AND r.active
WHERE NOT i.paused
  -- reminders fire only on their exact day (the clock moves one day at a time and ticks every day);
  -- a reminder whose day passed while the item was not open is skipped, never sent late.
  -- overdue alerts catch up: an item that is open and past due is always flagged.
  AND ((r.kind = 'reminder' AND i.due_date + r.offset_days = %(today)s
        AND %(today)s >= GREATEST(i.start_date, r.effective_from))
    OR (r.kind = 'overdue' AND i.due_date + r.offset_days <= %(today)s))
  AND NOT EXISTS (SELECT 1 FROM alerts x WHERE x.alert_key = {_KEY} || r.kind || ':' || r.offset_days)
ORDER BY i.entity_type, i.entity_id, r.offset_days
"""

ESCALATION_CANDIDATES_SQL = f"""
WITH items AS ({TRACKED_ITEMS_SQL})
SELECT i.*, e.id AS rule_id, 'escalation'::text AS kind, e.days_after_due AS offset_days,
       'escalation'::text AS template_code, e.level, l.title AS level_title, l.target,
       GREATEST(i.due_date + e.days_after_due, i.start_date, e.effective_from) AS trigger_date,
       {_KEY} || 'escalation:L' || e.level AS alert_key
FROM items i JOIN escalation_rules e ON e.entity_type = i.entity_type AND e.active
JOIN escalation_levels l ON l.level = e.level
WHERE NOT i.paused
  AND i.due_date + e.days_after_due <= %(today)s
  AND NOT EXISTS (SELECT 1 FROM alerts x WHERE x.alert_key = {_KEY} || 'escalation:L' || e.level)
ORDER BY i.entity_type, i.entity_id, e.level
"""

RESOLVE_SQL = f"""
WITH items AS ({TRACKED_ITEMS_SQL})
UPDATE escalations e SET status = 'resolved', resolved_at = %(now)s
WHERE e.status = 'open'
  AND NOT EXISTS (SELECT 1 FROM items i WHERE i.entity_type = e.entity_type AND i.entity_id = e.entity_id
                                         AND i.cycle = e.cycle)
RETURNING e.id, e.entity_type, e.entity_id, e.cycle, e.level
"""


# ------------------------------------------------------------------ recipients
def _owners(conn: Conn, it: dict, kind: str) -> list[int]:
    """Who is responsible for acting on the item (receives reminders and overdue alerts)."""
    et = it["entity_type"]
    if et == "stage":
        if it["detail"] == "sac":
            return [r["user_id"] for r in conn.all(
                """SELECT m.user_id FROM committee_members m JOIN committee_reviews r ON r.id = m.review_id
                   WHERE r.stage_id = %s ORDER BY m.user_id""", (it["stage_id"],))]
        owner = conn.val("SELECT assigned_to FROM application_stages WHERE id = %s", (it["stage_id"],))
        if owner:
            return [owner]
        rd = region_director(conn, it["region_id"])
        return [rd["id"]] if rd else []
    if et == "evc_step":
        status = it["detail"]
        if status == "availability_pending":
            return [r["user_id"] for r in conn.all(
                "SELECT user_id FROM evc_members WHERE visit_id = %s AND availability = 'pending' ORDER BY user_id",
                (it["entity_id"],))]
        if status in ("scheduled", "report_pending"):
            return [r["user_id"] for r in conn.all(
                "SELECT user_id FROM evc_members WHERE visit_id = %s ORDER BY is_convenor DESC, user_id",
                (it["entity_id"],))]
        owner = conn.val("SELECT assigned_to FROM application_stages WHERE id = %s", (it["stage_id"],))
        return [owner] if owner else []
    users = institution_users(conn, it["institution_id"])
    if kind == "overdue":
        if et == "deficiency":
            owner = conn.val("SELECT assigned_to FROM application_stages WHERE id = %s", (it["stage_id"],))
            users += [owner] if owner else []
        else:
            users += [o["id"] for o in region_officers(conn, it["region_id"])]
    return users


def _escalation_target(conn: Conn, it: dict, target: str) -> dict | None:
    if target == "region_director":
        return region_director(conn, it["region_id"])
    if target == "bureau_officer":
        return bureau_officer(conn)
    if target == "bureau_head":
        return bureau_head(conn)
    # assigned_officer
    if it["stage_id"]:
        uid = conn.val("SELECT assigned_to FROM application_stages WHERE id = %s", (it["stage_id"],))
        u = conn.one("SELECT * FROM users WHERE id = %s AND role = 'official'", (uid,)) if uid else None
        if u:
            return u
    officers = region_officers(conn, it["region_id"])
    return officers[0] if officers else region_director(conn, it["region_id"])


def _link(role: str, it: dict) -> str:
    et = it["entity_type"]
    if et in ("stage", "deficiency"):
        if role == "committee":
            return f"/cases/{it['application_id']}"
        return f"/applications/{it['application_id']}"
    if et == "evc_step":
        return f"/visits/{it['entity_id']}" if role == "committee" else "/evc"
    if et == "undertaking":
        return "/undertakings" if role == "institution" else "/compliance"
    return "/documents" if role == "institution" else "/validity"


def _days_text(n: int) -> str:
    if n == 0:
        return "due today"
    return f"in {n} day(s)" if n > 0 else f"{-n} day(s) ago"


# ------------------------------------------------------------------ tick
def _fire(conn: Conn, now: datetime, today: date, it: dict) -> dict | None:
    kind = it["kind"]
    days_to_due = (it["due_date"] - today).days
    ctx = {
        "item": it["item"], "ref": it["ref_no"] or "", "institution": it["institution"],
        "due_date": fmt_date(it["due_date"]), "days_text": _days_text(days_to_due),
        "days_late": max(-days_to_due, 0), "stage": it["item"], "level": it["level"] or "",
        "level_title": it["level_title"] or "", "ref_or_institution": it["ref_no"] or it["institution"],
    }
    msg = notifications.render(conn, it["template_code"], ctx)
    alert_id = conn.val(
        """INSERT INTO alerts (alert_key, entity_type, entity_id, cycle, kind, rule_id, offset_days, level, due_date,
                               trigger_date, fired_at, application_id, institution_id, region_id, title, message)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (alert_key) DO NOTHING RETURNING id""",
        (it["alert_key"], it["entity_type"], it["entity_id"], it["cycle"], kind, it["rule_id"], it["offset_days"],
         it["level"], it["due_date"], it["trigger_date"], now, it["application_id"], it["institution_id"],
         it["region_id"], msg["subject"], msg["body"]),
    )
    if alert_id is None:  # another tick already fired it
        return None

    owners = _owners(conn, it, "overdue" if kind == "escalation" else kind)
    target = None
    recipients = list(owners)
    if kind == "escalation":
        target = _escalation_target(conn, it, it["target"])
        if target:
            recipients = [target["id"]] + recipients
        conn.run(
            """INSERT INTO escalations (alert_id, entity_type, entity_id, cycle, level, due_date, escalated_at,
                                        target_user_id, status)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'open') ON CONFLICT DO NOTHING""",
            (alert_id, it["entity_type"], it["entity_id"], it["cycle"], it["level"], it["due_date"], now,
             target["id"] if target else None),
        )

    by_role: dict[str, list[int]] = defaultdict(list)
    for r in conn.all("SELECT id, role FROM users WHERE id = ANY(%s)", (recipients,)):
        by_role[r["role"]].append(r["id"])
    notified = 0
    for role, ids in by_role.items():
        ordered = [u for u in recipients if u in ids]
        notified += len(notifications.notify(conn, now=now, user_ids=ordered, template_code=it["template_code"],
                                             ctx=ctx, link=_link(role, it), kind=kind, alert_id=alert_id, sms=True))
    record(
        conn, at=now, actor=None,
        action="escalation.raised" if kind == "escalation" else "alert.fired",
        entity_type="alert", entity_id=alert_id, application_id=it["application_id"],
        details={"key": it["alert_key"], "kind": kind, "item": f"{it['entity_type']}:{it['entity_id']}",
                 "offset_days": it["offset_days"], "level": it["level"], "due_date": it["due_date"].isoformat(),
                 "trigger_date": it["trigger_date"].isoformat(), "recipients": len(set(recipients)),
                 "escalated_to": target["name"] if target else None},
    )
    return {"alert_id": alert_id, "notified": notified, "escalation": kind == "escalation"}


def run_alert_tick(conn: Conn, now: datetime) -> dict:
    """Evaluate every open item against the rules at simulated time `now`. Safe to call any number of times."""
    conn.run("SELECT pg_advisory_xact_lock(%s)", (TICK_LOCK,))
    today = ist_date(now)
    delivery = notifications.progress_outbox(conn, now)

    fired = {"alerts": 0, "escalations": 0, "notifications": 0, "resolved": 0}
    for sql in (REMINDER_CANDIDATES_SQL, ESCALATION_CANDIDATES_SQL):
        for it in conn.all(sql, {"today": today}):
            res = _fire(conn, now, today, it)
            if res:
                fired["alerts"] += 1
                fired["escalations"] += int(res["escalation"])
                fired["notifications"] += res["notified"]

    for row in conn.all(RESOLVE_SQL, {"now": now}):
        fired["resolved"] += 1
        record(conn, at=now, actor=None, action="escalation.resolved", entity_type="escalation", entity_id=row["id"],
               details={"item": f"{row['entity_type']}:{row['entity_id']}", "level": row["level"]})

    if any(delivery.values()):
        record(conn, at=now, actor=None, action="outbox.delivery_updated", entity_type="outbox", entity_id="batch",
               details={**delivery, "simulated": True})
    conn.run("UPDATE platform_clock SET last_tick_sim = %s, last_tick_wall = clock_timestamp() WHERE id = 1", (now,))
    return {**fired, "delivery": delivery, "today": today.isoformat()}


def maybe_tick(conn: Conn) -> dict | None:
    """Cheap guard used by /api/live: run the tick only if the clock moved since the last tick or the
    last tick is older than a few seconds of real time, and only if no other tick is running."""
    if not conn.val("SELECT pg_try_advisory_xact_lock(%s)", (TICK_LOCK,)):
        return None
    row = conn.one(
        """SELECT sim_now, (last_tick_sim IS NULL OR last_tick_sim <> sim_now
                  OR last_tick_wall < clock_timestamp() - make_interval(secs => %s)) AS due
           FROM platform_clock WHERE id = 1""",
        (LIVE_TICK_SECONDS,),
    )
    if row is None or not row["due"]:
        return None
    from app.clock import IST

    return run_alert_tick(conn, row["sim_now"].astimezone(IST))
