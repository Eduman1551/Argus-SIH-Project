"""Collects the facts of a case for summaries and letters (no opinions, no recommendations)."""

from __future__ import annotations

from datetime import datetime

from app.clock import ist_date
from app.common import fmt_date
from app.rules import setting
from db import Conn

EVC_STATUS_TEXT = {
    "assignment_pending": "waiting for committee assignment",
    "availability_pending": "members confirming availability",
    "date_pending": "visit date being fixed",
    "scheduled": "visit scheduled",
    "report_pending": "visit done, report pending",
    "report_submitted": "report submitted, review pending",
    "reviewed": "visit completed and report reviewed",
    "cancelled": "cancelled",
}
REPORT_TEXT = {
    "satisfactory": "satisfactory",
    "deficiencies_noted": "deficiencies noted",
    "not_satisfactory": "not satisfactory",
}


def case_facts(conn: Conn, app_id: int, now: datetime) -> dict:
    today = ist_date(now)
    a = conn.one(
        """SELECT a.*, i.name AS institution, i.city, r.name AS region, t.name AS type_name, ro.name AS route_name
           FROM applications a JOIN institutions i ON i.id = a.institution_id JOIN regions r ON r.id = a.region_id
           JOIN application_types t ON t.code = a.app_type LEFT JOIN routes ro ON ro.code = a.route_code
           WHERE a.id = %s""",
        (app_id,),
    )
    stages = conn.all(
        """SELECT s.*, st.name FROM application_stages s JOIN stages st ON st.code = s.stage_code
           WHERE s.application_id = %s ORDER BY s.id""",
        (app_id,),
    )
    inst_secs = 0
    stage_rows = []
    for s in stages:
        paused = s["paused_seconds"] + (int((now - s["paused_at"]).total_seconds()) if s["paused_at"] else 0)
        inst_secs += paused
        if s["status"] == "completed":
            days = (ist_date(s["completed_at"]) - ist_date(s["started_at"])).days
            text = f"completed on {fmt_date(s['completed_at'])} after {days} day(s)"
        elif s["status"] == "reverted":
            text = f"sent back on {fmt_date(s['completed_at'])}"
        else:
            text = f"in progress since {fmt_date(s['started_at'])}, due {fmt_date(s['due_at'])}"
        stage_rows.append({"name": s["name"], "status_text": text})
    elapsed = (today - ist_date(a["submitted_at"])).days
    inst_days = round(inst_secs / 86400)

    defs = conn.all("SELECT reason, responded_at FROM deficiencies WHERE application_id = %s ORDER BY id", (app_id,))
    evc = None
    v = conn.one("SELECT * FROM evc_visits WHERE application_id = %s AND status <> 'cancelled' ORDER BY id DESC LIMIT 1",
                 (app_id,))
    if v:
        rep = conn.one("SELECT findings, recommendation FROM visit_reports WHERE visit_id = %s", (v["id"],))
        status_text = EVC_STATUS_TEXT[v["status"]]
        if v["visit_date"]:
            status_text += f" (visit date {fmt_date(v['visit_date'])})"
        evc = {"status_text": status_text,
               "findings": rep["findings"] if rep else None,
               "recommendation_text": REPORT_TEXT.get(rep["recommendation"], "") if rep else ""}

    soon = int(setting(conn, "expiring_soon_days"))
    c = conn.one(
        """SELECT
             (SELECT count(*) FROM undertakings WHERE institution_id = %(i)s AND status <> 'verified') AS open_undertakings,
             (SELECT count(*) FROM undertakings WHERE institution_id = %(i)s AND status <> 'verified'
                AND ist_date(due_at) < %(t)s) AS overdue_undertakings,
             (SELECT count(*) FROM tracked_documents WHERE institution_id = %(i)s AND status <> 'renewal_submitted'
                AND expires_on < %(t)s) AS expired_documents,
             (SELECT count(*) FROM tracked_documents WHERE institution_id = %(i)s AND status <> 'renewal_submitted'
                AND expires_on >= %(t)s AND expires_on <= %(t)s + %(s)s) AS expiring_documents""",
        {"i": a["institution_id"], "t": today, "s": soon},
    )
    points = []
    open_defs = [d for d in defs if d["responded_at"] is None]
    if open_defs:
        points.append(f"{len(open_defs)} deficiency reply(ies) still pending from the institution.")
    if evc and evc["recommendation_text"] in ("deficiencies noted", "not satisfactory"):
        points.append(f"The expert visit report records: {evc['recommendation_text']}.")
    if c["overdue_undertakings"]:
        points.append(f"{c['overdue_undertakings']} undertaking(s) from earlier approvals are overdue.")
    if c["expired_documents"]:
        points.append(f"{c['expired_documents']} tracked document(s) (for example a lease) have expired.")

    return {
        "ref_no": a["ref_no"], "type_name": a["type_name"], "programme": a["programme"],
        "academic_year": a["academic_year"], "institution": a["institution"], "city": a["city"],
        "region": a["region"], "route_name": a["route_name"] or a["route_code"],
        "submitted": fmt_date(a["submitted_at"]), "elapsed_days": elapsed,
        "institution_days": inst_days, "aicte_days": max(elapsed - inst_days, 0),
        "stages": stage_rows,
        "deficiencies": [{"reason": d["reason"], "responded": fmt_date(d["responded_at"]) if d["responded_at"] else None}
                         for d in defs],
        "evc": evc, "compliance": c, "points": points,
    }
