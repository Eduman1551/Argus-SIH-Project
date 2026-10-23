"""Role-based dashboard payloads. Every number comes from the same functions the reports use."""

from __future__ import annotations

from collections import Counter
from datetime import datetime

from app import reports
from app.clock import ist_date
from app.scheduling import board
from db import Conn

AGE_BUCKETS = [(0, 15, "0-15 days"), (16, 30, "16-30 days"), (31, 60, "31-60 days"), (61, 90, "61-90 days"),
               (91, 10_000, "Over 90 days")]
STAGE_ORDER = ["intake", "scrutiny", "evc", "sac", "decision"]


def official_dashboard(conn: Conn, now: datetime, region_id: int | None) -> dict:
    rows = reports.pendency(conn, now, region_id)
    totals = reports.pendency_totals(rows)
    stage_names = {r["code"]: r["name"] for r in conn.all("SELECT code, name FROM stages")}
    by_stage = []
    for code in STAGE_ORDER:
        rs = [r for r in rows if r["stage_code"] == code]
        by_stage.append({
            "stage": code, "name": stage_names.get(code, code), "cases": len(rs),
            "overdue": sum(r["sla_status"] == "overdue" for r in rs),
            "avg_days_in_stage": round(sum(r["days_in_stage"] for r in rs) / len(rs), 1) if rs else 0,
        })
    regions = conn.all("SELECT id, name FROM regions ORDER BY id")
    by_region = [{"region_id": g["id"], "region": g["name"],
                  "cases": sum(r["region_id"] == g["id"] for r in rows),
                  "overdue": sum(r["region_id"] == g["id"] and r["sla_status"] == "overdue" for r in rows)}
                 for g in regions if region_id is None or g["id"] == region_id]
    ageing = [{"bucket": label, "cases": sum(lo <= r["age_days"] <= hi for r in rows)} for lo, hi, label in AGE_BUCKETS]
    bottleneck = max(by_stage, key=lambda s: (s["overdue"], s["avg_days_in_stage"])) if rows else None
    unassigned = conn.all(
        """SELECT v.id AS visit_id, a.id AS application_id, a.ref_no, i.name AS institution, v.step_due_at
           FROM evc_visits v JOIN applications a ON a.id = v.application_id JOIN institutions i ON i.id = a.institution_id
           WHERE v.status = 'assignment_pending' AND (%(r)s::int IS NULL OR a.region_id = %(r)s)
           UNION ALL
           SELECT NULL, a.id, a.ref_no, i.name, s.due_at FROM application_stages s
           JOIN applications a ON a.id = s.application_id JOIN institutions i ON i.id = a.institution_id
           WHERE s.status = 'active' AND s.assigned_to IS NULL AND (%(r)s::int IS NULL OR a.region_id = %(r)s)
           ORDER BY 5""",
        {"r": region_id})
    near = sorted([r for r in rows if r["sla_status"] == "due_soon"], key=lambda r: r["days_to_due"])
    overdue = sorted([r for r in rows if r["sla_status"] == "overdue"], key=lambda r: r["days_to_due"])
    unds = reports.undertakings(conn, now, region_id, include_closed=False)
    docs = reports.documents(conn, now, region_id)
    evc = [v for v in board(conn, now) if region_id is None or v["region_id"] == region_id]
    n = len(rows) or 1
    return {
        "scope": "All Regions" if region_id is None else next(g["name"] for g in regions if g["id"] == region_id),
        "totals": totals,
        "avg_age_days": round(sum(r["age_days"] for r in rows) / n, 1),
        "avg_institution_days": round(totals["institution_days"] / n, 1),
        "avg_aicte_days": round(totals["aicte_days"] / n, 1),
        "by_stage": by_stage, "by_region": by_region, "ageing": ageing, "bottleneck": bottleneck,
        "unassigned": unassigned, "near_deadline": near[:12], "overdue_list": overdue,
        "compliance": {
            "undertakings_overdue": sum(u["state"] == "overdue" for u in unds),
            "undertakings_due_soon": sum(u["state"] == "due_soon" for u in unds),
            "evidence_waiting": sum(u["state"] == "awaiting_verification" for u in unds),
            "documents_expired": sum(d["state"] == "expired" for d in docs),
            "documents_expiring": sum(d["state"] == "expiring_soon" for d in docs),
            "renewals_waiting": sum(d["state"] == "renewal_submitted" for d in docs),
            "evc_delayed": sum(v["category"] == "delayed" for v in evc),
            "evc_due": sum(v["category"] == "due" for v in evc),
        },
        "escalations_by_level": dict(Counter(str(lvl["level"]) for lvl in conn.all(
            """SELECT e.level FROM escalations e LEFT JOIN alerts a ON a.id = e.alert_id
               WHERE e.status = 'open' AND (%(r)s::int IS NULL OR a.region_id = %(r)s)""", {"r": region_id}))),
    }


def institution_home(conn: Conn, now: datetime, institution_id: int) -> dict:
    today = ist_date(now)
    pend = {r["id"]: r for r in reports.pendency(conn, now, institution_id=institution_id)}
    apps = conn.all(
        """SELECT a.id, a.ref_no, t.name AS type_name, a.programme, a.status, a.decision, a.submitted_at, a.decided_at,
                  st.name AS stage_name, s.stage_code, s.substatus
           FROM applications a JOIN application_types t ON t.code = a.app_type
           JOIN application_stages s ON s.id = a.current_stage_id JOIN stages st ON st.code = s.stage_code
           WHERE a.institution_id = %s ORDER BY a.submitted_at DESC""", (institution_id,))
    for a in apps:
        p = pend.get(a["id"])
        a["sla_status"] = p["sla_status"] if p else None
        a["substatus_text"] = p["substatus_text"] if p else "Decided"
        a["due_date"] = p["due_date"] if p else None
        a["waiting_on"] = p["waiting_on"] if p else None
        for k in ("days_to_due", "stage_started", "stage_due", "days_in_stage", "stage_paused_days", "stage_paused_now",
                  "stage_open_pause_days"):
            a[k] = p[k] if p else None
    deficiencies = conn.all(
        """SELECT d.id, d.application_id, a.ref_no, d.reason, d.raised_at, d.response_due_at, u.name AS raised_by
           FROM deficiencies d JOIN applications a ON a.id = d.application_id JOIN users u ON u.id = d.raised_by
           WHERE a.institution_id = %s AND d.status = 'open' ORDER BY d.response_due_at""", (institution_id,))
    for d in deficiencies:
        d["days_to_due"] = (ist_date(d["response_due_at"]) - today).days
    visits = conn.all(
        """SELECT v.id, a.ref_no, a.id AS application_id, v.status, v.visit_date, v.step_due_at
           FROM evc_visits v JOIN applications a ON a.id = v.application_id
           WHERE a.institution_id = %s AND v.status NOT IN ('cancelled') ORDER BY v.visit_date NULLS LAST""",
        (institution_id,))
    unds = reports.undertakings(conn, now, institution_id=institution_id)
    docs = reports.documents(conn, now, institution_id=institution_id)
    actions = []
    for d in deficiencies:
        actions.append({"kind": "deficiency", "title": f"Reply to deficiency on {d['ref_no']}",
                        "due_date": ist_date(d["response_due_at"]), "days_to_due": d["days_to_due"],
                        "link": f"/applications/{d['application_id']}"})
    for u in unds:
        if u["state"] in ("open", "due_soon", "overdue") or u["status"] == "resubmission_requested":
            if u["state"] == "open" and u["days_to_due"] > 30 and u["status"] != "resubmission_requested":
                continue
            actions.append({"kind": "undertaking", "title": f"Upload evidence: {u['condition_text']}",
                            "due_date": u["due_date"], "days_to_due": u["days_to_due"], "link": "/undertakings"})
    for d in docs:
        if d["state"] in ("expired", "expiring_soon") or d["status"] == "renewal_rejected":
            actions.append({"kind": "document", "title": f"Upload renewed {d['title']}",
                            "due_date": d["expires_on"], "days_to_due": d["days_to_expiry"], "link": "/documents"})
    actions.sort(key=lambda a: a["days_to_due"])
    return {
        "applications": apps, "pending_actions": actions, "deficiencies": deficiencies, "visits": visits,
        "undertakings": [u for u in unds if u["state"] != "closed"],
        "evidence_waiting": [u for u in unds if u["state"] == "awaiting_verification"],
        "documents_attention": [d for d in docs if d["state"] in ("expired", "expiring_soon", "renewal_submitted")],
        "counts": {
            "applications": len(apps), "in_progress": sum(a["status"] == "in_progress" for a in apps),
            "actions": len(actions), "overdue_actions": sum(a["days_to_due"] < 0 for a in actions),
        },
    }


def committee_cases(conn: Conn, now: datetime, user_id: int) -> dict:
    today = ist_date(now)
    visit_ids = [r["visit_id"] for r in conn.all(
        """SELECT m.visit_id FROM evc_members m JOIN evc_visits v ON v.id = m.visit_id
           WHERE m.user_id = %s AND v.status <> 'cancelled'""", (user_id,))]
    visits = board(conn, now, visit_ids) if visit_ids else []
    for v in visits:
        me = next(m for m in v["members"] if m["user_id"] == user_id)
        v["my_availability"] = me["availability"]
        v["i_am_convenor"] = me["is_convenor"]
        if v["status"] == "availability_pending" and me["availability"] == "pending":
            v["my_action"] = "Confirm your availability"
        elif v["status"] == "scheduled" and v["visit_date"] <= today:
            v["my_action"] = "Mark the visit as conducted"
        elif v["status"] == "report_pending":
            v["my_action"] = "Submit the visit report"
        else:
            v["my_action"] = None
    reviews = conn.all(
        """SELECT r.id, r.application_id, a.ref_no, i.name AS institution, t.name AS type_name, r.status,
                  r.recommendation, r.recommended_at, s.due_at, s.started_at
           FROM committee_members m JOIN committee_reviews r ON r.id = m.review_id
           JOIN applications a ON a.id = r.application_id JOIN institutions i ON i.id = a.institution_id
           JOIN application_types t ON t.code = a.app_type JOIN application_stages s ON s.id = r.stage_id
           WHERE m.user_id = %s AND r.status <> 'cancelled' ORDER BY r.status DESC, s.due_at""", (user_id,))
    for r in reviews:
        r["days_to_due"] = (ist_date(r["due_at"]) - today).days
    return {
        "visits": visits, "reviews": reviews,
        "counts": {"visits_open": sum(v["status"] != "reviewed" for v in visits),
                   "actions": sum(1 for v in visits if v["my_action"]) + sum(r["status"] == "pending" for r in reviews),
                   "reviews_pending": sum(r["status"] == "pending" for r in reviews)},
    }
