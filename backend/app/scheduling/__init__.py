"""Scheduling engine for Expert Visit Committees (EVC).

Visit journey (each step has its own configured time limit, tracked by the alert tick):
  assignment_pending   -> officer assigns members                 (SLA evc_assignment)
  availability_pending -> each member confirms available dates    (SLA evc_availability)
  date_pending         -> officer fixes the visit date             (SLA evc_scheduling)
  scheduled            -> visit is conducted on the visit date     (due = visit date)
  report_pending       -> convenor submits the visit report        (SLA evc_report)
  report_submitted     -> officer reviews the report               (SLA evc_review)
  reviewed             -> EVC stage complete, case routed onwards
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app import notifications
from app.audit import record
from app.clock import ist_date
from app.common import (
    Invalid,
    NotAllowed,
    NotFound,
    due_after,
    end_of_day,
    ensure,
    fmt_date,
    institution_users,
    require_text,
)
from app.rules import setting, sla_days
from db import Conn

STEP_OF_STATUS = {
    "assignment_pending": ("assignment", "Assign EVC members"),
    "availability_pending": ("availability", "Confirm availability"),
    "date_pending": ("scheduling", "Fix visit date"),
    "scheduled": ("visit", "Conduct the visit"),
    "report_pending": ("report", "Submit visit report"),
    "report_submitted": ("review", "Review visit report"),
}
REPORT_OPTIONS = {"satisfactory": "Satisfactory", "deficiencies_noted": "Deficiencies noted",
                  "not_satisfactory": "Not satisfactory"}


def _visit(conn: Conn, visit_id: int) -> dict:
    v = conn.one("SELECT * FROM evc_visits WHERE id = %s FOR UPDATE", (visit_id,))
    if v is None:
        raise NotFound("EVC visit not found.")
    return v


def _app(conn: Conn, app_id: int) -> dict:
    from app.workflow import get_application

    return get_application(conn, app_id, lock=True)


def _ctx(app: dict, **extra) -> dict:
    return {"ref": app["ref_no"], "institution": app["institution_name"], **extra}


def _set_status(conn: Conn, now: datetime, v: dict, status: str, due: datetime | None) -> None:
    conn.run("UPDATE evc_visits SET status = %s, step_started_at = %s, step_due_at = %s WHERE id = %s",
             (status, now, due, v["id"]))
    conn.run("UPDATE application_stages SET substatus = %s WHERE id = %s", (status, v["stage_id"]))
    v["status"] = status


def create_visit(conn: Conn, now: datetime, app: dict, stage: dict) -> int:
    due = due_after(now, sla_days(conn, "evc_assignment"))
    vid = conn.val(
        """INSERT INTO evc_visits (application_id, stage_id, status, step_started_at, step_due_at, created_at)
           VALUES (%s,%s,'assignment_pending',%s,%s,%s) RETURNING id""",
        (app["id"], stage["id"], now, due, now),
    )
    record(conn, at=now, actor=None, action="evc.queued", entity_type="evc_visit", entity_id=vid,
           application_id=app["id"], details={"assign_by": ist_date(due).isoformat()})
    return vid


def members(conn: Conn, visit_id: int) -> list[dict]:
    return conn.all(
        """SELECT m.user_id, m.is_convenor, m.availability, m.available_dates, m.responded_at, u.name, u.designation
           FROM evc_members m JOIN users u ON u.id = m.user_id WHERE m.visit_id = %s
           ORDER BY m.is_convenor DESC, u.name""",
        (visit_id,),
    )


def is_member(conn: Conn, visit_id: int, user_id: int) -> bool:
    return bool(conn.val("SELECT 1 FROM evc_members WHERE visit_id = %s AND user_id = %s", (visit_id, user_id)))


def assign_members(conn: Conn, now: datetime, actor: dict, visit_id: int, member_ids: list[int],
                   convenor_id: int) -> None:
    ensure(actor["role"] == "official", "Only officials assign EVC members.", NotAllowed)
    v = _visit(conn, visit_id)
    ensure(v["status"] in ("assignment_pending", "availability_pending", "date_pending"),
           "Members can be assigned only before the visit is scheduled.")
    member_ids = list(dict.fromkeys(int(m) for m in member_ids))
    ensure(2 <= len(member_ids) <= 5, "Assign between 2 and 5 members.", Invalid)
    ensure(convenor_id in member_ids, "The convenor must be one of the members.", Invalid)
    valid = conn.all("SELECT id, name FROM users WHERE id = ANY(%s) AND role = 'committee' AND committee_kind = 'EVC'",
                     (member_ids,))
    ensure(len(valid) == len(member_ids), "All members must be EVC committee members.", Invalid)
    app = _app(conn, v["application_id"])
    conn.run("DELETE FROM evc_members WHERE visit_id = %s", (visit_id,))
    conn.many("INSERT INTO evc_members (visit_id, user_id, is_convenor) VALUES (%s,%s,%s)",
              [(visit_id, m, m == convenor_id) for m in member_ids])
    due = due_after(now, sla_days(conn, "evc_availability"))
    conn.run("UPDATE evc_visits SET assigned_at = %s WHERE id = %s", (now, visit_id))
    _set_status(conn, now, v, "availability_pending", due)
    record(conn, at=now, actor=actor, action="evc.members_assigned", entity_type="evc_visit", entity_id=visit_id,
           application_id=app["id"],
           details={"members": sorted(r["name"] for r in valid), "convenor_id": convenor_id,
                    "confirm_by": ist_date(due).isoformat()})
    notifications.notify(conn, now=now, user_ids=member_ids, template_code="event.evc_assigned",
                         ctx=_ctx(app, due_date=fmt_date(due)), link=f"/visits/{visit_id}", kind="task")


def respond_availability(conn: Conn, now: datetime, actor: dict, visit_id: int, available: bool,
                         dates: list[date] | None) -> None:
    v = _visit(conn, visit_id)
    ensure(actor["role"] == "committee" and is_member(conn, visit_id, actor["id"]),
           "Only an assigned EVC member can confirm availability.", NotAllowed)
    ensure(v["status"] == "availability_pending", "Availability is not being collected for this visit now.")
    today = ist_date(now)
    dates = sorted({date.fromisoformat(d) if isinstance(d, str) else d for d in (dates or [])})
    if available:
        ensure(1 <= len(dates) <= 10, "Pick between 1 and 10 dates you can visit.", Invalid)
        ensure(all(today < d <= today + timedelta(days=60) for d in dates),
               "Dates must be after today and within 60 days.", Invalid)
    else:
        dates = []
    conn.run("""UPDATE evc_members SET availability = %s, available_dates = %s, responded_at = %s
                WHERE visit_id = %s AND user_id = %s""",
             ("available" if available else "unavailable", dates, now, visit_id, actor["id"]))
    app = _app(conn, v["application_id"])
    record(conn, at=now, actor=actor, action="evc.availability_given", entity_type="evc_visit", entity_id=visit_id,
           application_id=app["id"],
           details={"available": available, "dates": [d.isoformat() for d in dates]})
    pending = conn.val("SELECT count(*) FROM evc_members WHERE visit_id = %s AND availability = 'pending'", (visit_id,))
    if pending == 0:
        due = due_after(now, sla_days(conn, "evc_scheduling"))
        _set_status(conn, now, v, "date_pending", due)
        record(conn, at=now, actor=None, action="evc.availability_complete", entity_type="evc_visit",
               entity_id=visit_id, application_id=app["id"],
               details={"common_dates": [d.isoformat() for d in common_dates(conn, visit_id)],
                        "fix_date_by": ist_date(due).isoformat()})


def common_dates(conn: Conn, visit_id: int) -> list[date]:
    rows = members(conn, visit_id)
    sets = [set(r["available_dates"]) for r in rows if r["availability"] == "available"]
    if not sets or len(sets) < len(rows):
        return sorted(set().union(*sets)) if sets else []
    return sorted(set.intersection(*sets))


def schedule_visit(conn: Conn, now: datetime, actor: dict, visit_id: int, visit_date: date) -> None:
    ensure(actor["role"] == "official", "Only officials fix the visit date.", NotAllowed)
    v = _visit(conn, visit_id)
    ensure(v["status"] in ("date_pending", "scheduled"),
           "The visit date can be fixed once all members have confirmed availability.")
    visit_date = date.fromisoformat(visit_date) if isinstance(visit_date, str) else visit_date
    today = ist_date(now)
    ensure(today < visit_date <= today + timedelta(days=60), "Visit date must be after today and within 60 days.", Invalid)
    rescheduled = v["status"] == "scheduled"
    conn.run("UPDATE evc_visits SET visit_date = %s, scheduled_at = %s WHERE id = %s", (visit_date, now, visit_id))
    _set_status(conn, now, v, "scheduled", end_of_day(visit_date))
    app = _app(conn, v["application_id"])
    record(conn, at=now, actor=actor, action="evc.rescheduled" if rescheduled else "evc.scheduled",
           entity_type="evc_visit", entity_id=visit_id, application_id=app["id"],
           details={"visit_date": visit_date.isoformat(),
                    "previous": v["visit_date"].isoformat() if rescheduled and v["visit_date"] else None})
    users = [m["user_id"] for m in members(conn, visit_id)] + institution_users(conn, app["institution_id"])
    notifications.notify(conn, now=now, user_ids=users, template_code="event.visit_scheduled",
                         ctx=_ctx(app, visit_date=fmt_date(visit_date)), link=f"/visits/{visit_id}", kind="update",
                         sms=True)


def mark_conducted(conn: Conn, now: datetime, actor: dict, visit_id: int) -> None:
    v = _visit(conn, visit_id)
    ensure(actor["role"] == "official" or (actor["role"] == "committee" and is_member(conn, visit_id, actor["id"])),
           "Only the visit committee or an official can mark the visit as conducted.", NotAllowed)
    ensure(v["status"] == "scheduled", "Only a scheduled visit can be marked as conducted.")
    ensure(ist_date(now) >= v["visit_date"], "The visit date has not arrived yet.")
    due = due_after(now, sla_days(conn, "evc_report"))
    conn.run("UPDATE evc_visits SET conducted_at = %s WHERE id = %s", (now, visit_id))
    _set_status(conn, now, v, "report_pending", due)
    record(conn, at=now, actor=actor, action="evc.conducted", entity_type="evc_visit", entity_id=visit_id,
           application_id=v["application_id"],
           details={"visit_date": v["visit_date"].isoformat(), "report_due": ist_date(due).isoformat(),
                    "days_late": (ist_date(now) - v["visit_date"]).days})


def submit_report(conn: Conn, now: datetime, actor: dict, visit_id: int, findings: str, recommendation: str,
                  file_id: int | None = None) -> None:
    v = _visit(conn, visit_id)
    ensure(actor["role"] == "committee" and is_member(conn, visit_id, actor["id"]),
           "Only a member of the visit committee can submit the report.", NotAllowed)
    ensure(v["status"] == "report_pending", "The report can be submitted after the visit is marked as conducted.")
    ensure(recommendation in REPORT_OPTIONS, "Unknown report outcome.", Invalid)
    findings = require_text(findings, "Findings", 20)
    conn.run("""INSERT INTO visit_reports (visit_id, submitted_by, submitted_at, findings, recommendation, file_id)
                VALUES (%s,%s,%s,%s,%s,%s)""", (visit_id, actor["id"], now, findings, recommendation, file_id))
    due = due_after(now, sla_days(conn, "evc_review"))
    conn.run("UPDATE evc_visits SET report_submitted_at = %s WHERE id = %s", (now, visit_id))
    _set_status(conn, now, v, "report_submitted", due)
    app = _app(conn, v["application_id"])
    record(conn, at=now, actor=actor, action="evc.report_submitted", entity_type="evc_visit", entity_id=visit_id,
           application_id=app["id"], details={"outcome": recommendation, "file_id": file_id})
    stage_owner = conn.val("SELECT assigned_to FROM application_stages WHERE id = %s", (v["stage_id"],))
    notifications.notify(conn, now=now, user_ids=[stage_owner], template_code="event.report_submitted",
                         ctx=_ctx(app), link=f"/applications/{app['id']}", kind="task")


def review_report(conn: Conn, now: datetime, actor: dict, visit_id: int, remarks: str | None) -> None:
    """Officer reviews the visit report; the EVC stage completes and the case is routed onwards."""
    from app.workflow import current_stage, finish_stage

    ensure(actor["role"] == "official", "Only officials review visit reports.", NotAllowed)
    v = _visit(conn, visit_id)
    ensure(v["status"] == "report_submitted", "There is no submitted report waiting for review.")
    app = _app(conn, v["application_id"])
    stage = current_stage(conn, app)
    ensure(stage["id"] == v["stage_id"], "This visit is not for the active stage of the case.")
    conn.run("""UPDATE evc_visits SET status = 'reviewed', reviewed_at = %s, reviewed_by = %s, review_remarks = %s,
                       step_due_at = NULL WHERE id = %s""", (now, actor["id"], (remarks or "").strip() or None, visit_id))
    record(conn, at=now, actor=actor, action="evc.report_reviewed", entity_type="evc_visit", entity_id=visit_id,
           application_id=app["id"], details={"remarks": remarks})
    finish_stage(conn, now, actor, app, stage, remarks)


# ------------------------------------------------------------------ board
def board_category(v: dict, today: date, due_window: int) -> str:
    """Queue / Coordinating / Scheduled / Due / Delayed / Report / Completed."""
    if v["status"] == "reviewed":
        return "completed"
    if v["step_due_at"] is not None and ist_date(v["step_due_at"]) < today:
        return "delayed"
    if v["status"] == "assignment_pending":
        return "queue"
    if v["status"] in ("availability_pending", "date_pending"):
        return "coordinating"
    if v["status"] == "scheduled":
        return "due" if (v["visit_date"] - today).days <= due_window else "scheduled"
    return "report"


def board(conn: Conn, now: datetime, visit_ids: list[int] | None = None) -> list[dict]:
    today = ist_date(now)
    window = int(setting(conn, "evc_due_window_days"))
    rows = conn.all(
        """SELECT v.*, a.ref_no, a.institution_id, i.name AS institution, i.city, r.name AS region, r.id AS region_id,
                  s.assigned_to AS officer_id, o.name AS officer,
                  (SELECT max(level) FROM escalations e WHERE e.entity_type = 'evc_step' AND e.entity_id = v.id
                     AND e.status = 'open') AS escalation_level
           FROM evc_visits v JOIN applications a ON a.id = v.application_id
           JOIN institutions i ON i.id = a.institution_id JOIN regions r ON r.id = a.region_id
           JOIN application_stages s ON s.id = v.stage_id LEFT JOIN users o ON o.id = s.assigned_to
           WHERE v.status <> 'cancelled' AND (%s::int[] IS NULL OR v.id = ANY(%s::int[]))
           ORDER BY v.step_due_at NULLS LAST, v.id""",
        (visit_ids, visit_ids),
    )
    all_members: dict[int, list[dict]] = {}
    if rows:
        for m in conn.all(
            """SELECT m.visit_id, m.user_id, m.is_convenor, m.availability, m.available_dates, m.responded_at,
                      u.name, u.designation
               FROM evc_members m JOIN users u ON u.id = m.user_id WHERE m.visit_id = ANY(%s)
               ORDER BY m.visit_id, m.is_convenor DESC, u.name""",
            ([v["id"] for v in rows],),
        ):
            all_members.setdefault(m.pop("visit_id"), []).append(m)
    for v in rows:
        v["category"] = board_category(v, today, window)
        step = STEP_OF_STATUS.get(v["status"])
        v["step"] = step[1] if step else "Completed"
        v["days_to_due"] = (ist_date(v["step_due_at"]) - today).days if v["step_due_at"] else None
        v["members"] = all_members.get(v["id"], [])
    return rows
