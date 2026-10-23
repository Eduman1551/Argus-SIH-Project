"""Case page payload: everything about one application, plus the actions this user may take."""

from __future__ import annotations

from datetime import datetime

from app import documents, reports
from app.clock import ist_date
from app.common import can_decide
from app.scheduling import common_dates, is_member, members
from app.workflow import REVIEW_STAGES
from app.workflow.committee import RECOMMENDATIONS
from db import Conn


def case_detail(conn: Conn, now: datetime, user: dict, app_id: int) -> dict:
    today = ist_date(now)
    a = conn.one(
        """SELECT a.*, i.name AS institution, i.city, i.kind AS institution_kind, r.name AS region,
                  t.name AS type_name, ro.name AS route_name, du.name AS decided_by_name
           FROM applications a JOIN institutions i ON i.id = a.institution_id JOIN regions r ON r.id = a.region_id
           JOIN application_types t ON t.code = a.app_type LEFT JOIN routes ro ON ro.code = a.route_code
           LEFT JOIN users du ON du.id = a.decided_by WHERE a.id = %s""", (app_id,))
    names = {r["code"]: r["name"] for r in conn.all("SELECT code, name FROM stages")}
    rows = conn.all(
        """SELECT s.*, u.name AS assignee, c.name AS completed_by_name FROM application_stages s
           LEFT JOIN users u ON u.id = s.assigned_to LEFT JOIN users c ON c.id = s.completed_by
           WHERE s.application_id = %s ORDER BY s.id""", (app_id,))
    route = []
    for seq, code in enumerate(a["route_snapshot"], start=1):
        attempts = [r for r in rows if r["seq"] == seq]
        last = attempts[-1] if attempts else None
        state = "pending" if last is None else {"active": "active", "completed": "done", "reverted": "reverted"}[last["status"]]
        days = None
        if last and last["completed_at"]:
            days = (ist_date(last["completed_at"]) - ist_date(last["started_at"])).days
        elif last:
            days = (today - ist_date(last["started_at"])).days
        route.append({
            "seq": seq, "code": code, "name": names.get(code, code), "state": state,
            "attempts": len(attempts), "assignee": last["assignee"] if last else None,
            "started": last["started_at"] if last else None, "completed": last["completed_at"] if last else None,
            "due": last["due_at"] if last else None, "days": days,
            "institution_days": round(last["paused_seconds"] / 86400) if last else 0,
            "on_time": (ist_date(last["completed_at"]) <= ist_date(last["due_at"])) if last and last["completed_at"] else None,
        })
    cur = next((r for r in rows if r["id"] == a["current_stage_id"]), None)
    pend = reports.pendency(conn, now, application_ids=[app_id])
    sla = pend[0] if pend else None

    defs = conn.all(
        """SELECT d.*, u.name AS raised_by_name, ru.name AS responded_by_name, s.stage_code
           FROM deficiencies d JOIN users u ON u.id = d.raised_by LEFT JOIN users ru ON ru.id = d.responded_by
           JOIN application_stages s ON s.id = d.stage_id WHERE d.application_id = %s ORDER BY d.id""", (app_id,))
    def_files = documents.list_for(conn, "deficiency", [d["id"] for d in defs]) if defs else []
    for d in defs:
        d["files"] = [f for f in def_files if f["entity_id"] == d["id"]]
        d["days_to_due"] = (ist_date(d["response_due_at"]) - today).days

    visit = conn.one("""SELECT v.*, rv.name AS reviewed_by_name FROM evc_visits v LEFT JOIN users rv ON rv.id = v.reviewed_by
                        WHERE v.application_id = %s AND v.status <> 'cancelled' ORDER BY v.id DESC LIMIT 1""", (app_id,))
    if visit:
        visit["members"] = members(conn, visit["id"])
        visit["common_dates"] = common_dates(conn, visit["id"])
        visit["report"] = conn.one("""SELECT r.*, u.name AS submitted_by_name FROM visit_reports r
                                      JOIN users u ON u.id = r.submitted_by WHERE r.visit_id = %s""", (visit["id"],))
        visit["files"] = documents.list_for(conn, "evc_visit", [visit["id"]])
        visit["days_to_step_due"] = (ist_date(visit["step_due_at"]) - today).days if visit["step_due_at"] else None

    review = conn.one("""SELECT r.*, u.name AS recommended_by_name FROM committee_reviews r
                         LEFT JOIN users u ON u.id = r.recommended_by
                         WHERE r.application_id = %s AND r.status <> 'cancelled' ORDER BY r.id DESC LIMIT 1""", (app_id,))
    if review:
        review["members"] = conn.all("""SELECT u.id, u.name, u.designation FROM committee_members m
                                        JOIN users u ON u.id = m.user_id WHERE m.review_id = %s ORDER BY u.name""",
                                     (review["id"],))
        review["recommendation_text"] = RECOMMENDATIONS.get(review["recommendation"])

    unds = [u for u in reports.undertakings(conn, now, institution_id=a["institution_id"]) if u["application_id"] == app_id]
    timeline = conn.all(
        """SELECT id, at, actor_label, actor_id, action, entity_type, entity_id, details FROM audit_log
           WHERE application_id = %s ORDER BY id""", (app_id,))
    alerts = conn.all("""SELECT id, kind, level, title, trigger_date, fired_at, entity_type FROM alerts
                         WHERE application_id = %s ORDER BY id DESC LIMIT 50""", (app_id,))

    return {
        "application": a, "route": route, "current": cur, "sla": sla, "deficiencies": defs, "visit": visit,
        "review": review, "undertakings": unds, "files": documents.list_for(conn, "application", [app_id]),
        "timeline": timeline, "alerts": alerts,
        "actions": _actions(conn, user, a, cur, visit, review, defs, today),
        "options": _options(conn, user, a, cur),
    }


def _actions(conn, user, a, cur, visit, review, defs, today) -> list[str]:
    acts: list[str] = []
    active = a["status"] == "in_progress" and cur is not None and cur["status"] == "active"
    code = cur["stage_code"] if cur else None
    role = user["role"]
    if role == "official":
        acts.append("draft_letter")
        if active:
            if code in REVIEW_STAGES and cur["substatus"] in ("in_review", "re_review"):
                acts += ["complete_review", "raise_deficiency"]
            if code in ("intake", "scrutiny", "evc", "decision"):
                acts.append("reassign")
            if code in ("evc", "sac", "decision") and any(s in REVIEW_STAGES for s in a["route_snapshot"][: cur["seq"] - 1]):
                acts.append("revert")
            if code == "decision" and can_decide(user):
                acts.append("record_decision")
            if code == "evc" and visit:
                st = visit["status"]
                if st in ("assignment_pending", "availability_pending", "date_pending"):
                    acts.append("assign_members")
                if st in ("date_pending", "scheduled"):
                    acts.append("schedule_visit")
                if st == "scheduled" and visit["visit_date"] and visit["visit_date"] <= today:
                    acts.append("mark_conducted")
                if st == "report_submitted":
                    acts.append("review_report")
            if code == "sac" and review and review["status"] == "pending":
                acts += ["assign_committee", "regenerate_summary"]
    elif role == "institution":
        if any(d["status"] == "open" for d in defs):
            acts.append("respond_deficiency")
        if a["status"] == "in_progress":
            acts.append("upload_document")
    elif role == "committee" and active:
        if code == "evc" and visit and is_member(conn, visit["id"], user["id"]):
            me = next(m for m in visit["members"] if m["user_id"] == user["id"])
            if visit["status"] == "availability_pending" and me["availability"] == "pending":
                acts.append("respond_availability")
            if visit["status"] == "scheduled" and visit["visit_date"] and visit["visit_date"] <= today:
                acts.append("mark_conducted")
            if visit["status"] == "report_pending":
                acts.append("submit_report")
        if code == "sac" and review and review["status"] == "pending" and any(
                m["id"] == user["id"] for m in review["members"]):
            acts += ["recommend", "regenerate_summary"]
    return acts


def _options(conn, user, a, cur) -> dict:
    if user["role"] != "official":
        return {}
    officials = conn.all(
        """SELECT u.id, u.name, u.designation, u.rank, u.official_kind,
                  (SELECT count(*) FROM application_stages s WHERE s.assigned_to = u.id AND s.status = 'active') AS load
           FROM users u WHERE u.role = 'official' AND (u.region_id = %s OR u.official_kind = 'bureau')
           ORDER BY u.official_kind DESC, u.rank, u.name""", (a["region_id"],))
    evc = conn.all("""SELECT u.id, u.name, u.designation,
                             (SELECT count(*) FROM evc_members m JOIN evc_visits v ON v.id = m.visit_id
                               WHERE m.user_id = u.id AND v.status NOT IN ('reviewed', 'cancelled')) AS load
                      FROM users u WHERE u.role = 'committee' AND u.committee_kind = 'EVC' ORDER BY u.name""")
    sac = conn.all("SELECT id, name, designation FROM users WHERE role = 'committee' AND committee_kind = 'SAC' ORDER BY name")
    seq = cur["seq"] if cur else 1
    return {
        "officials": officials, "evc_members": evc, "sac_members": sac,
        "revert_targets": [s for s in a["route_snapshot"][: seq - 1] if s in REVIEW_STAGES],
    }
