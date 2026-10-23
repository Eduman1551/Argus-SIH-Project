"""KPIs (all computed live from the database; targets are our own suggestions, not official requirements)."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.alerts import TRACKED_ITEMS_SQL
from app.audit import verify_chain
from app.clock import ist_date
from app.reports import overdue_items, pendency
from app.rules import setting
from db import Conn


def _pct(ok: int, total: int) -> float | None:
    return None if total == 0 else round(100.0 * ok / total, 1)


def routing_accuracy(conn: Conn) -> dict:
    """Every application's stage history must follow its route, in order, without skipping."""
    apps = conn.all("SELECT id, ref_no, status, route_snapshot FROM applications ORDER BY id")
    stages = conn.all("""SELECT application_id, seq, stage_code, status FROM application_stages
                         WHERE status <> 'reverted' ORDER BY application_id, id""")
    by_app: dict[int, list[dict]] = {}
    for s in stages:
        by_app.setdefault(s["application_id"], []).append(s)
    wrong = []
    for a in apps:
        hist = by_app.get(a["id"], [])
        route = a["route_snapshot"]
        # with reverts a stage may repeat; compare the last attempt of each seq in order
        last = {}
        for s in hist:
            last[s["seq"]] = s
        seqs = sorted(last)
        ok = seqs == list(range(1, len(seqs) + 1)) and all(last[q]["stage_code"] == route[q - 1] for q in seqs)
        if a["status"] == "decided":
            ok = ok and len(seqs) == len(route) and all(last[q]["status"] == "completed" for q in seqs)
        else:
            ok = ok and all(last[q]["status"] == "completed" for q in seqs[:-1])
        if not ok:
            wrong.append(a["ref_no"])
    return {"value": _pct(len(apps) - len(wrong), len(apps)), "checked": len(apps), "wrong": wrong,
            "target": 100.0, "unit": "%"}


def alert_timeliness(conn: Conn) -> dict:
    r = conn.one("""SELECT count(*) AS total, count(*) FILTER (WHERE ist_date(fired_at) = trigger_date) AS on_time,
                           count(*) FILTER (WHERE kind = 'reminder') AS reminders
                    FROM alerts""")
    return {"value": _pct(r["on_time"], r["total"]), "checked": r["total"], "on_time": r["on_time"],
            "late": r["total"] - r["on_time"], "target": 100.0, "unit": "%"}


def deadline_reliability(conn: Conn, now: datetime) -> dict:
    """Independent check: open items past their due date that have NO overdue alert."""
    today = ist_date(now)
    misses = conn.all(
        """SELECT 'stage' AS kind, s.id FROM application_stages s
            WHERE s.status = 'active' AND s.stage_code <> 'evc' AND s.paused_at IS NULL AND ist_date(s.due_at) < %(t)s
              AND NOT EXISTS (SELECT 1 FROM alerts x WHERE x.entity_type = 'stage' AND x.entity_id = s.id
                              AND x.kind = 'overdue')
           UNION ALL
           SELECT 'deficiency', d.id FROM deficiencies d
            WHERE d.status = 'open' AND ist_date(d.response_due_at) < %(t)s
              AND NOT EXISTS (SELECT 1 FROM alerts x WHERE x.entity_type = 'deficiency' AND x.entity_id = d.id
                              AND x.kind = 'overdue')
           UNION ALL
           SELECT 'evc_step', v.id FROM evc_visits v
            WHERE v.status IN ('assignment_pending', 'availability_pending', 'date_pending', 'scheduled',
                               'report_pending', 'report_submitted')
              AND ist_date(v.step_due_at) < %(t)s
              AND NOT EXISTS (SELECT 1 FROM alerts x WHERE x.entity_type = 'evc_step' AND x.entity_id = v.id
                              AND x.kind = 'overdue' AND x.due_date = ist_date(v.step_due_at))
           UNION ALL
           SELECT 'undertaking', u.id FROM undertakings u
            WHERE u.status IN ('open', 'resubmission_requested') AND ist_date(u.due_at) < %(t)s
              AND NOT EXISTS (SELECT 1 FROM alerts x WHERE x.entity_type = 'undertaking' AND x.entity_id = u.id
                              AND x.kind = 'overdue')
           UNION ALL
           SELECT 'document', t.id FROM tracked_documents t
            WHERE t.status IN ('valid', 'renewal_rejected') AND t.expires_on < %(t)s
              AND NOT EXISTS (SELECT 1 FROM alerts x WHERE x.entity_type = 'document' AND x.entity_id = t.id
                              AND x.kind = 'overdue' AND x.due_date = t.expires_on)""",
        {"t": today},
    )
    checked = conn.val(
        """SELECT (SELECT count(*) FROM application_stages WHERE status = 'active' AND stage_code <> 'evc'
                     AND paused_at IS NULL AND ist_date(due_at) < %(t)s)
                + (SELECT count(*) FROM deficiencies WHERE status = 'open' AND ist_date(response_due_at) < %(t)s)
                + (SELECT count(*) FROM evc_visits WHERE status NOT IN ('reviewed', 'cancelled')
                     AND ist_date(step_due_at) < %(t)s)
                + (SELECT count(*) FROM undertakings WHERE status IN ('open', 'resubmission_requested')
                     AND ist_date(due_at) < %(t)s)
                + (SELECT count(*) FROM tracked_documents WHERE status IN ('valid', 'renewal_rejected')
                     AND expires_on < %(t)s)""",
        {"t": today},
    )
    return {"value": len(misses), "checked": int(checked), "missed": [f"{m['kind']}:{m['id']}" for m in misses],
            "target": 0, "unit": "items"}


def pendency_visibility(conn: Conn, now: datetime) -> dict:
    """Overdue cases (computed independently) that appear on the official dashboard and in the overdue report."""
    from app.api.dashboards import official_dashboard

    today = ist_date(now)
    truth = {r["id"] for r in conn.all(
        """SELECT a.id FROM applications a JOIN application_stages s ON s.id = a.current_stage_id
           LEFT JOIN deficiencies d ON d.stage_id = s.id AND d.status = 'open'
           LEFT JOIN evc_visits v ON v.stage_id = s.id AND v.status NOT IN ('cancelled', 'reviewed')
           WHERE a.status = 'in_progress' AND
                 CASE WHEN d.id IS NOT NULL THEN ist_date(d.response_due_at)
                      WHEN s.stage_code = 'evc' THEN ist_date(v.step_due_at)
                      ELSE ist_date(s.due_at) END < %(t)s""",
        {"t": today})}
    dash = official_dashboard(conn, now, None)
    on_dashboard = {r["id"] for r in dash["overdue_list"]}
    in_report = {int(i["link"].rsplit("/", 1)[1]) for i in overdue_items(conn, now) if i["kind"] == "Application"}
    visible = truth & on_dashboard & in_report
    return {"value": _pct(len(visible), len(truth)) if truth else 100.0, "checked": len(truth),
            "visible": len(visible), "missing": sorted(truth - visible), "target": 100.0, "unit": "%"}


def followup_reduction(conn: Conn) -> dict:
    r = conn.one("""SELECT count(*) FILTER (WHERE kind = 'reminder') AS reminders,
                           count(*) FILTER (WHERE kind = 'overdue') AS overdue,
                           count(*) FILTER (WHERE kind = 'escalation') AS escalations FROM alerts""")
    msgs = conn.val("SELECT count(*) FROM outbox WHERE alert_id IS NOT NULL")
    per = int(setting(conn, "assumed_manual_followups_per_alert"))
    total = r["reminders"] + r["overdue"] + r["escalations"]
    return {"value": total * per, "reminders": r["reminders"], "overdue_alerts": r["overdue"],
            "escalations": r["escalations"], "messages": msgs, "assumed_per_alert": per,
            "target": None, "unit": "follow-ups"}


def escalation_coverage(conn: Conn, now: datetime) -> dict:
    """Open overdue items: did each reach every escalation level it should have by now, on the right day?"""
    today = ist_date(now)
    items = conn.all(f"WITH items AS ({TRACKED_ITEMS_SQL}) SELECT * FROM items WHERE NOT paused AND due_date < %(t)s",
                     {"t": today})
    rules = conn.all("SELECT entity_type, level, days_after_due, effective_from FROM escalation_rules WHERE active")
    esc = {(e["entity_type"], e["entity_id"], e["cycle"], e["level"]): e for e in conn.all(
        "SELECT entity_type, entity_id, cycle, level, escalated_at FROM escalations")}
    needing, correct, wrong = 0, 0, []
    for it in items:
        expected = [r for r in rules if r["entity_type"] == it["entity_type"]
                    and it["due_date"] + timedelta(days=r["days_after_due"]) <= today]
        if not expected:
            continue
        needing += 1
        ok = True
        for r in expected:
            e = esc.get((it["entity_type"], it["entity_id"], it["cycle"], r["level"]))
            want = max(it["due_date"] + timedelta(days=r["days_after_due"]), it["start_date"], r["effective_from"])
            if e is None or ist_date(e["escalated_at"]) != want:
                ok = False
        if ok:
            correct += 1
        else:
            wrong.append(f"{it['entity_type']}:{it['entity_id']}")
    return {"value": _pct(correct, needing) if needing else 100.0, "checked": needing, "correct": correct,
            "wrong": wrong, "target": 100.0, "unit": "%"}


AUDIT_CHECKS = [
    ("Alerts and escalations", "SELECT id::text AS k FROM alerts",
     "SELECT entity_id AS k FROM audit_log WHERE action IN ('alert.fired', 'escalation.raised')"),
    ("Stage starts", "SELECT id::text AS k FROM application_stages",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'stage.started'"),
    ("Stage completions", """SELECT id::text AS k FROM application_stages WHERE status = 'completed'
                             AND stage_code <> 'decision'""",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'stage.completed'"),
    ("Decisions", "SELECT id::text AS k FROM applications WHERE status = 'decided'",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'decision.recorded'"),
    ("Deficiencies raised", "SELECT id::text AS k FROM deficiencies",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'deficiency.raised'"),
    ("Deficiency replies", "SELECT id::text AS k FROM deficiencies WHERE status = 'responded'",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'deficiency.responded'"),
    ("Evidence submissions", "SELECT undertaking_id::text || '#' || count(*) AS k FROM evidence_submissions GROUP BY undertaking_id",
     """SELECT entity_id || '#' || count(*) AS k FROM audit_log WHERE action = 'undertaking.evidence_submitted'
        GROUP BY entity_id"""),
    ("Evidence verifications", """SELECT undertaking_id::text || '#' || count(*) AS k FROM evidence_submissions
                                  WHERE review_status <> 'pending' GROUP BY undertaking_id""",
     """SELECT entity_id || '#' || count(*) AS k FROM audit_log
        WHERE action IN ('undertaking.verified', 'undertaking.resubmission_requested') GROUP BY entity_id"""),
    ("Uploaded files", "SELECT id::text AS k FROM files",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'document.uploaded'"),
    ("Visit reports", "SELECT visit_id::text AS k FROM visit_reports",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'evc.report_submitted'"),
    ("Committee recommendations", "SELECT id::text AS k FROM committee_reviews WHERE status = 'recommended'",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'committee.recommended'"),
    ("Resolved escalations", "SELECT id::text AS k FROM escalations WHERE status = 'resolved'",
     "SELECT entity_id AS k FROM audit_log WHERE action = 'escalation.resolved'"),
]


def audit_completeness(conn: Conn) -> dict:
    total, ok, by_check = 0, 0, []
    for label, things_sql, audit_sql in AUDIT_CHECKS:
        things = {r["k"] for r in conn.all(things_sql)}
        audited = {r["k"] for r in conn.all(audit_sql)}
        hit = len(things & audited)
        total += len(things)
        ok += hit
        by_check.append({"label": label, "records": len(things), "audited": hit})
    chain = verify_chain(conn)
    return {"value": _pct(ok, total), "checked": total, "audited": ok, "by_check": by_check,
            "chain_valid": chain["valid"], "chain_entries": chain["checked"], "target": 100.0, "unit": "%"}


def stage_times(conn: Conn) -> dict:
    rows = conn.all(
        """SELECT st.code, st.name, count(*) AS n,
                  avg(EXTRACT(EPOCH FROM (s.completed_at - s.started_at)) / 86400.0) AS total_days,
                  avg(s.paused_seconds / 86400.0) AS institution_days,
                  avg(CASE WHEN ist_date(s.completed_at) <= ist_date(s.due_at) THEN 1.0 ELSE 0.0 END) AS on_time
           FROM application_stages s JOIN stages st ON st.code = s.stage_code
           WHERE s.status = 'completed' GROUP BY st.code, st.name, st.sort ORDER BY st.sort""")
    out = []
    for r in rows:
        total, inst = float(r["total_days"]), float(r["institution_days"])
        out.append({"stage": r["code"], "name": r["name"], "completed": r["n"], "avg_days": round(total, 1),
                    "avg_institution_days": round(inst, 1), "avg_aicte_days": round(total - inst, 1),
                    "on_time_pct": round(100 * float(r["on_time"]), 1)})
    return {"value": None, "stages": out, "unit": "days"}


def compute(conn: Conn, now: datetime) -> dict:
    return {
        "as_of": now.isoformat(),
        "note": "Targets are our own suggestions, not official requirements. All values are computed live.",
        "kpis": [
            {"id": 1, "name": "Workflow routing accuracy",
             "explain": "Share of applications whose stage history follows their configured route in order.",
             **routing_accuracy(conn)},
            {"id": 2, "name": "Alert timeliness",
             "explain": "Share of alerts that fired on exactly the day their rule says (simulated clock).",
             **alert_timeliness(conn)},
            {"id": 3, "name": "Deadline tracking reliability",
             "explain": "Open items past their due date that the engine did NOT flag. Lower is better.",
             **deadline_reliability(conn, now)},
            {"id": 4, "name": "Pendency visibility",
             "explain": "Share of overdue cases that appear on the dashboard and in the overdue report.",
             **pendency_visibility(conn, now)},
            {"id": 5, "name": "Manual follow-up reduction",
             "explain": "Follow-ups sent automatically, each assumed to replace one manual follow-up (assumption).",
             **followup_reduction(conn)},
            {"id": 6, "name": "Escalation coverage",
             "explain": "Share of overdue items that reached every escalation level due so far, on the right day.",
             **escalation_coverage(conn, now)},
            {"id": 7, "name": "Audit completeness",
             "explain": "Share of state changes, alerts, submissions and verifications with an audit entry.",
             **audit_completeness(conn)},
            {"id": 8, "name": "Average processing time per stage",
             "explain": "Average days per completed stage, split into waiting on the institution and on AICTE.",
             **stage_times(conn)},
        ],
    }


__all__ = ["compute", "pendency"]
