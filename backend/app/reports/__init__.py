"""Reports and the pendency computations shared with the dashboards.

Dashboards call the same functions as the reports, so their totals always agree. Every report has
columns, rows and totals, and can be exported as CSV.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime

from app.clock import ist_date
from app.compliance import document_state, undertaking_state
from app.rules import setting
from app.scheduling import board
from db import Conn

SUBSTATUS_TEXT = {
    "in_review": "Under review",
    "re_review": "Re-scrutiny",
    "awaiting_institution": "Waiting for institution reply",
    "assignment_pending": "EVC members to be assigned",
    "availability_pending": "EVC members confirming dates",
    "date_pending": "EVC visit date to be fixed",
    "scheduled": "EVC visit scheduled",
    "report_pending": "EVC report pending",
    "report_submitted": "EVC report under review",
    "reviewed": "EVC completed",
    "awaiting_recommendation": "With SAC/SHC committee",
    "awaiting_decision": "Awaiting decision",
    "completed": "Completed",
}


def sla_status(due: date | None, today: date, due_soon: int) -> str:
    if due is None:
        return "on_track"
    if due < today:
        return "overdue"
    if (due - today).days <= due_soon:
        return "due_soon"
    return "on_track"


# ------------------------------------------------------------------ pendency
def pendency(conn: Conn, now: datetime, region_id: int | None = None, institution_id: int | None = None,
             application_ids: list[int] | None = None) -> list[dict]:
    """One row per application in progress, with ageing and SLA position."""
    today = ist_date(now)
    due_soon = int(setting(conn, "due_soon_days"))
    rows = conn.all(
        """SELECT a.id, a.ref_no, a.app_type, t.name AS type_name, ro.name AS route_name, a.submitted_at,
                  a.academic_year, a.programme, i.id AS institution_id, i.name AS institution, r.id AS region_id,
                  r.name AS region, s.id AS stage_id, s.stage_code, st.name AS stage_name, s.substatus,
                  s.started_at, s.due_at, s.paused_at, s.paused_seconds AS stage_paused_secs, s.assigned_to,
                  u.name AS assignee,
                  (SELECT COALESCE(sum(x.paused_seconds), 0) FROM application_stages x
                    WHERE x.application_id = a.id) AS paused_secs,
                  d.response_due_at, v.step_due_at, v.visit_date,
                  (SELECT max(e.level) FROM escalations e JOIN alerts al ON al.id = e.alert_id
                    WHERE e.status = 'open' AND al.application_id = a.id
                      AND al.entity_type IN ('stage', 'deficiency', 'evc_step')) AS escalation_level
           FROM applications a
           JOIN institutions i ON i.id = a.institution_id JOIN regions r ON r.id = a.region_id
           JOIN application_types t ON t.code = a.app_type LEFT JOIN routes ro ON ro.code = a.route_code
           JOIN application_stages s ON s.id = a.current_stage_id JOIN stages st ON st.code = s.stage_code
           LEFT JOIN users u ON u.id = s.assigned_to
           LEFT JOIN deficiencies d ON d.stage_id = s.id AND d.status = 'open'
           LEFT JOIN evc_visits v ON v.stage_id = s.id AND v.status NOT IN ('cancelled', 'reviewed')
           WHERE a.status = 'in_progress'
             AND (%(r)s::int IS NULL OR a.region_id = %(r)s)
             AND (%(i)s::int IS NULL OR a.institution_id = %(i)s)
             AND (%(ids)s::int[] IS NULL OR a.id = ANY(%(ids)s::int[]))
           ORDER BY a.submitted_at, a.id""",
        {"r": region_id, "i": institution_id, "ids": application_ids},
    )
    out = []
    for a in rows:
        paused = a["paused_secs"] + (int((now - a["paused_at"]).total_seconds()) if a["paused_at"] else 0)
        age = (today - ist_date(a["submitted_at"])).days
        inst_days = round(paused / 86400)
        if a["response_due_at"] is not None:
            due, waiting_on = ist_date(a["response_due_at"]), "institution"
        elif a["stage_code"] == "evc":
            due = ist_date(a["step_due_at"]) if a["step_due_at"] else None
            waiting_on = "committee" if a["substatus"] in ("availability_pending", "scheduled", "report_pending") else "aicte"
        else:
            due = ist_date(a["due_at"])
            waiting_on = "committee" if a["stage_code"] == "sac" else "aicte"
        status = sla_status(due, today, due_soon)
        out.append({
            "id": a["id"], "ref_no": a["ref_no"], "institution_id": a["institution_id"], "institution": a["institution"],
            "region_id": a["region_id"], "region": a["region"], "type_name": a["type_name"],
            "route_name": a["route_name"], "programme": a["programme"], "stage_code": a["stage_code"],
            "stage_name": a["stage_name"], "substatus": a["substatus"],
            "substatus_text": SUBSTATUS_TEXT.get(a["substatus"], a["substatus"]),
            "assignee": a["assignee"], "assigned_to": a["assigned_to"],
            "submitted": ist_date(a["submitted_at"]), "stage_started": ist_date(a["started_at"]),
            "days_in_stage": (today - ist_date(a["started_at"])).days, "age_days": age,
            "waiting_institution_days": inst_days, "waiting_aicte_days": max(age - inst_days, 0),
            "due_date": due, "days_to_due": (due - today).days if due else None,
            "waiting_on": waiting_on, "sla_status": status, "escalation_level": a["escalation_level"],
            # read-only detail for the SLA bar: the current stage's own window and its institution time
            "stage_due": ist_date(a["due_at"]),
            "stage_paused_days": round((a["stage_paused_secs"] + (int((now - a["paused_at"]).total_seconds())
                                                                  if a["paused_at"] else 0)) / 86400),
            "stage_paused_now": a["paused_at"] is not None,
            # an open pause extends the stage due date only when the institution replies
            "stage_open_pause_days": (today - ist_date(a["paused_at"])).days if a["paused_at"] else 0,
        })
    return out


def pendency_totals(rows: list[dict]) -> dict:
    return {
        "cases": len(rows),
        "overdue": sum(r["sla_status"] == "overdue" for r in rows),
        "due_soon": sum(r["sla_status"] == "due_soon" for r in rows),
        "on_track": sum(r["sla_status"] == "on_track" for r in rows),
        "waiting_on_institution": sum(r["waiting_on"] == "institution" for r in rows),
        "escalated": sum(1 for r in rows if r["escalation_level"]),
        "institution_days": sum(r["waiting_institution_days"] for r in rows),
        "aicte_days": sum(r["waiting_aicte_days"] for r in rows),
    }


# ------------------------------------------------------------------ other item lists
def undertakings(conn: Conn, now: datetime, region_id: int | None = None, institution_id: int | None = None,
                 include_closed: bool = True) -> list[dict]:
    today = ist_date(now)
    due_soon = int(setting(conn, "due_soon_days"))
    rows = conn.all(
        """SELECT u.id, u.application_id, a.ref_no, u.institution_id, i.name AS institution, r.id AS region_id,
                  r.name AS region, u.condition_text, u.due_at, u.status, u.created_at, u.closed_at,
                  (SELECT max(e.level) FROM escalations e WHERE e.entity_type = 'undertaking' AND e.entity_id = u.id
                     AND e.status = 'open') AS escalation_level,
                  (SELECT row_to_json(x) FROM (SELECT es.id, es.file_id, es.note, es.submitted_at, es.review_status,
                          es.review_remarks, f.filename FROM evidence_submissions es LEFT JOIN files f ON f.id = es.file_id
                          WHERE es.undertaking_id = u.id ORDER BY es.id DESC LIMIT 1) x) AS last_submission
           FROM undertakings u JOIN applications a ON a.id = u.application_id
           JOIN institutions i ON i.id = u.institution_id JOIN regions r ON r.id = i.region_id
           WHERE (%(r)s::int IS NULL OR i.region_id = %(r)s) AND (%(i)s::int IS NULL OR u.institution_id = %(i)s)
             AND (%(c)s OR u.status <> 'verified')
           ORDER BY u.due_at, u.id""",
        {"r": region_id, "i": institution_id, "c": include_closed},
    )
    for u in rows:
        u["due_date"] = ist_date(u["due_at"])
        u["days_to_due"] = (u["due_date"] - today).days
        u["state"] = undertaking_state(u, today, due_soon)
    return rows


def documents(conn: Conn, now: datetime, region_id: int | None = None, institution_id: int | None = None) -> list[dict]:
    today = ist_date(now)
    soon = int(setting(conn, "expiring_soon_days"))
    rows = conn.all(
        """SELECT t.id, t.institution_id, i.name AS institution, r.id AS region_id, r.name AS region, t.doc_type,
                  t.title, t.issued_by, t.valid_from, t.expires_on, t.status, t.file_id, t.renewal_file_id,
                  t.renewal_expires_on, t.renewal_submitted_at, t.verified_at, t.remarks,
                  (SELECT max(e.level) FROM escalations e WHERE e.entity_type = 'document' AND e.entity_id = t.id
                     AND e.status = 'open') AS escalation_level
           FROM tracked_documents t JOIN institutions i ON i.id = t.institution_id JOIN regions r ON r.id = i.region_id
           WHERE (%(r)s::int IS NULL OR i.region_id = %(r)s) AND (%(i)s::int IS NULL OR t.institution_id = %(i)s)
           ORDER BY t.expires_on, t.id""",
        {"r": region_id, "i": institution_id},
    )
    for d in rows:
        d["state"] = document_state(d, today, soon)
        d["days_to_expiry"] = (d["expires_on"] - today).days
    return rows


def overdue_items(conn: Conn, now: datetime, region_id: int | None = None) -> list[dict]:
    """Every overdue item of any kind, with its escalation level."""
    items = []
    for p in pendency(conn, now, region_id):
        if p["sla_status"] == "overdue":
            items.append({"kind": "Application", "ref": p["ref_no"], "institution": p["institution"],
                          "region": p["region"], "what": f"{p['stage_name']}: {p['substatus_text']}",
                          "due_date": p["due_date"], "days_overdue": -p["days_to_due"],
                          "waiting_on": p["waiting_on"], "escalation_level": p["escalation_level"],
                          "link": f"/applications/{p['id']}"})
    for u in undertakings(conn, now, region_id, include_closed=False):
        if u["state"] == "overdue":
            items.append({"kind": "Undertaking", "ref": u["ref_no"], "institution": u["institution"],
                          "region": u["region"], "what": u["condition_text"], "due_date": u["due_date"],
                          "days_overdue": -u["days_to_due"], "waiting_on": "institution",
                          "escalation_level": u["escalation_level"], "link": "/compliance"})
    for d in documents(conn, now, region_id):
        if d["state"] == "expired":
            items.append({"kind": "Document", "ref": d["title"], "institution": d["institution"],
                          "region": d["region"], "what": f"{d['title']} expired", "due_date": d["expires_on"],
                          "days_overdue": -d["days_to_expiry"], "waiting_on": "institution",
                          "escalation_level": d["escalation_level"], "link": "/validity"})
    items.sort(key=lambda x: (-(x["escalation_level"] or 0), -x["days_overdue"]))
    return items


def region_performance(conn: Conn, now: datetime) -> list[dict]:
    pend = pendency(conn, now)
    unds = undertakings(conn, now)
    docs = documents(conn, now)
    decided = conn.all(
        """SELECT region_id, count(*) AS n,
                  avg(ist_date(decided_at) - ist_date(submitted_at)) AS avg_days
           FROM applications WHERE status = 'decided' GROUP BY region_id""")
    dec = {d["region_id"]: d for d in decided}
    out = []
    for r in conn.all("SELECT id, name FROM regions ORDER BY id"):
        p = [x for x in pend if x["region_id"] == r["id"]]
        u = [x for x in unds if x["region_id"] == r["id"]]
        d = [x for x in docs if x["region_id"] == r["id"]]
        out.append({
            "region_id": r["id"], "region": r["name"],
            "in_progress": len(p), "overdue": sum(x["sla_status"] == "overdue" for x in p),
            "escalated": sum(1 for x in p if x["escalation_level"]),
            "decided": int(dec[r["id"]]["n"]) if r["id"] in dec else 0,
            "avg_days_to_decision": round(float(dec[r["id"]]["avg_days"]), 1) if r["id"] in dec else None,
            "undertakings_open": sum(x["state"] != "closed" for x in u),
            "undertakings_overdue": sum(x["state"] == "overdue" for x in u),
            "documents_expired": sum(x["state"] == "expired" for x in d),
            "documents_expiring": sum(x["state"] == "expiring_soon" for x in d),
        })
    return out


# ------------------------------------------------------------------ report catalogue
def _sum(rows, key):
    return sum(r[key] or 0 for r in rows)


REPORTS = {
    "pendency": "Pendency and ageing",
    "evc": "EVC status",
    "undertakings": "Undertaking compliance",
    "documents": "Document validity",
    "overdue": "Overdue items",
    "regions": "Region-wise performance",
}


def build(conn: Conn, now: datetime, name: str, region_id: int | None = None) -> dict:
    if name == "pendency":
        rows = pendency(conn, now, region_id)
        cols = [("ref_no", "Reference"), ("institution", "Institution"), ("region", "Region"), ("type_name", "Type"),
                ("stage_name", "Stage"), ("substatus_text", "Status"), ("assignee", "With"), ("age_days", "Age (days)"),
                ("days_in_stage", "Days in stage"), ("waiting_institution_days", "Waiting on institution (days)"),
                ("waiting_aicte_days", "Waiting on AICTE/committee (days)"), ("due_date", "Due"),
                ("sla_status", "SLA"), ("escalation_level", "Escalation")]
        totals = pendency_totals(rows)
    elif name == "evc":
        rows = [v for v in board(conn, now) if region_id is None or v["region_id"] == region_id]
        for v in rows:
            v["members_text"] = ", ".join(m["name"] for m in v["members"])
        cols = [("ref_no", "Reference"), ("institution", "Institution"), ("region", "Region"), ("step", "Current step"),
                ("category", "Board"), ("visit_date", "Visit date"), ("step_due_at", "Step due"),
                ("members_text", "Members"), ("escalation_level", "Escalation")]
        totals = {c: sum(v["category"] == c for v in rows)
                  for c in ("queue", "coordinating", "scheduled", "due", "delayed", "report", "completed")}
        totals["visits"] = len(rows)
    elif name == "undertakings":
        rows = undertakings(conn, now, region_id)
        cols = [("ref_no", "Reference"), ("institution", "Institution"), ("region", "Region"),
                ("condition_text", "Condition"), ("due_date", "Due"), ("state", "State"),
                ("escalation_level", "Escalation")]
        totals = {s: sum(u["state"] == s for u in rows)
                  for s in ("open", "due_soon", "overdue", "awaiting_verification", "closed")}
        totals["undertakings"] = len(rows)
    elif name == "documents":
        rows = documents(conn, now, region_id)
        cols = [("institution", "Institution"), ("region", "Region"), ("title", "Document"), ("expires_on", "Expires"),
                ("days_to_expiry", "Days to expiry"), ("state", "State"), ("escalation_level", "Escalation")]
        totals = {s: sum(d["state"] == s for d in rows) for s in ("valid", "expiring_soon", "expired", "renewal_submitted")}
        totals["documents"] = len(rows)
    elif name == "overdue":
        rows = overdue_items(conn, now, region_id)
        cols = [("kind", "Kind"), ("ref", "Reference"), ("institution", "Institution"), ("region", "Region"),
                ("what", "Item"), ("due_date", "Due"), ("days_overdue", "Days overdue"), ("waiting_on", "Waiting on"),
                ("escalation_level", "Escalation")]
        totals = {"items": len(rows), "escalated": sum(1 for r in rows if r["escalation_level"]),
                  "applications": sum(r["kind"] == "Application" for r in rows),
                  "undertakings": sum(r["kind"] == "Undertaking" for r in rows),
                  "documents": sum(r["kind"] == "Document" for r in rows)}
    elif name == "regions":
        rows = region_performance(conn, now)
        if region_id is not None:
            rows = [r for r in rows if r["region_id"] == region_id]
        cols = [("region", "Region"), ("in_progress", "In progress"), ("overdue", "Overdue"), ("escalated", "Escalated"),
                ("decided", "Decided"), ("avg_days_to_decision", "Avg days to decision"),
                ("undertakings_open", "Undertakings open"), ("undertakings_overdue", "Undertakings overdue"),
                ("documents_expired", "Documents expired"), ("documents_expiring", "Documents expiring")]
        totals = {k: _sum(rows, k) for k in ("in_progress", "overdue", "escalated", "decided", "undertakings_open",
                                             "undertakings_overdue", "documents_expired", "documents_expiring")}
    else:
        raise KeyError(name)
    return {"name": name, "title": REPORTS[name], "columns": [{"key": k, "label": label} for k, label in cols],
            "rows": rows, "totals": totals}


def to_csv(report: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["SYNTHETIC DATA - Argus prototype, not an official AICTE system"])
    w.writerow([c["label"] for c in report["columns"]])
    for r in report["rows"]:
        w.writerow(["" if r.get(c["key"]) is None else r.get(c["key"]) for c in report["columns"]])
    w.writerow([])
    w.writerow(["Totals"] + [f"{k}: {v}" for k, v in report["totals"].items()])
    return buf.getvalue()
