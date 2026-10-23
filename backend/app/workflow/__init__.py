"""Workflow engine: application state machine, routing, transitions, guards, return and revert.

An application follows the ordered stage list of its route (fixed at submission). The engine only
routes, assigns and records. Decisions are recorded by a competent human; nothing here decides.

Stage kinds and their sub-states:
  intake / scrutiny : in_review -> awaiting_institution (deficiency open, SLA paused) -> re_review -> completed
  evc               : mirrors the EVC visit status (see app.scheduling)
  sac               : awaiting_recommendation -> completed (when a committee member records a recommendation)
  decision          : awaiting_decision -> completed (when the competent authority records the decision)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app import notifications
from app.audit import record
from app.clock import ist_date
from app.common import (
    Invalid,
    InvalidAction,
    NotAllowed,
    NotFound,
    can_decide,
    due_after,
    end_of_day,
    ensure,
    fmt_date,
    institution_users,
    region_director,
    region_officers,
    require_text,
)
from app.rules import route_for_type, sla_days, stage_sla_days
from db import Conn

REVIEW_STAGES = ("intake", "scrutiny")
DECISIONS = {
    "approved": "Approved",
    "approved_with_undertakings": "Approved with undertakings",
    "not_approved": "Not approved",
}


# ------------------------------------------------------------------ lookups
def get_application(conn: Conn, app_id: int, lock: bool = False) -> dict:
    row = conn.one(
        """SELECT a.*, i.name AS institution_name, r.code AS region_code, r.name AS region_name
           FROM applications a JOIN institutions i ON i.id = a.institution_id JOIN regions r ON r.id = a.region_id
           WHERE a.id = %s""" + (" FOR UPDATE OF a" if lock else ""),
        (app_id,),
    )
    if row is None:
        raise NotFound("Application not found.")
    return row


def current_stage(conn: Conn, app: dict) -> dict:
    row = conn.one(
        """SELECT s.*, st.name AS stage_name FROM application_stages s JOIN stages st ON st.code = s.stage_code
           WHERE s.id = %s FOR UPDATE OF s""",
        (app["current_stage_id"],),
    )
    if row is None:
        raise InvalidAction("Application has no current stage.")
    return row


def stage_name(conn: Conn, code: str) -> str:
    return conn.val("SELECT name FROM stages WHERE code = %s", (code,)) or code


def _ctx(app: dict, **extra) -> dict:
    return {"ref": app["ref_no"], "institution": app["institution_name"], "region": app.get("region_name"), **extra}


def _link(app: dict) -> str:
    return f"/applications/{app['id']}"


# ------------------------------------------------------------------ assignment
def pick_by_workload(conn: Conn, region_id: int) -> dict | None:
    """Regional officer in the Region with the fewest active stages assigned (ties: lowest id)."""
    officers = region_officers(conn, region_id)
    if not officers:
        return region_director(conn, region_id)
    loads = {r["assigned_to"]: r["n"] for r in conn.all(
        """SELECT assigned_to, count(*) AS n FROM application_stages
           WHERE status = 'active' AND assigned_to = ANY(%s) GROUP BY assigned_to""",
        ([o["id"] for o in officers],))}
    return min(officers, key=lambda o: (loads.get(o["id"], 0), o["id"]))


def _assign(conn: Conn, now: datetime, actor: dict | None, app: dict, stage: dict, user: dict, method: str) -> None:
    before = stage["assigned_to"]
    conn.run("UPDATE application_stages SET assigned_to = %s WHERE id = %s", (user["id"], stage["id"]))
    stage["assigned_to"] = user["id"]
    record(conn, at=now, actor=actor, action="stage.assigned", entity_type="stage", entity_id=stage["id"],
           application_id=app["id"],
           details={"stage": stage["stage_code"], "assigned_to": user["id"], "assignee": user["name"],
                    "previous": before, "method": method})
    notifications.notify(conn, now=now, user_ids=[user["id"]], template_code="event.assigned",
                         ctx=_ctx(app, stage=stage_name(conn, stage["stage_code"]), due_date=fmt_date(stage["due_at"])),
                         link=_link(app), kind="task")


def reassign(conn: Conn, now: datetime, actor: dict, app_id: int, user_id: int) -> None:
    ensure(actor["role"] == "official", "Only officials can assign work.", NotAllowed)
    app = get_application(conn, app_id, lock=True)
    ensure(app["status"] == "in_progress", "This application is already decided.")
    stage = current_stage(conn, app)
    ensure(stage["status"] == "active", "The current stage is not active.")
    ensure(stage["stage_code"] != "sac", "SAC/SHC reviews are assigned to committee members, not officers.")
    user = conn.one("SELECT * FROM users WHERE id = %s", (user_id,))
    ensure(user is not None and user["role"] == "official", "Work can only be assigned to an official.", Invalid)
    if stage["stage_code"] == "decision":
        ensure(can_decide(user), "Decisions can only be assigned to a competent authority (Regional Director or Bureau).", Invalid)
    ensure(stage["assigned_to"] != user_id, "The case is already assigned to this official.")
    _assign(conn, now, actor, app, stage, user, method="manual")


# ------------------------------------------------------------------ intake and routing
def submit_application(
    conn: Conn, now: datetime, actor: dict, *, app_type: str, programme: str, academic_year: str,
    demo_tag: str | None = None,
) -> int:
    ensure(actor["role"] == "institution", "Only an institution can submit an application.", NotAllowed)
    programme = require_text(programme, "Programme / proposal description", 5)
    route_code, stages = route_for_type(conn, app_type)
    ensure(len(stages) >= 2, "The configured route for this application type is empty.")
    inst = conn.one("SELECT i.*, r.code AS region_code FROM institutions i JOIN regions r ON r.id = i.region_id WHERE i.id = %s",
                    (actor["institution_id"],))
    app_id = conn.val("SELECT nextval(pg_get_serial_sequence('applications', 'id'))")
    ref_no = f"ARG/{academic_year[:4]}/{inst['region_code']}/{app_id:04d}"
    conn.run(
        """INSERT INTO applications (id, ref_no, institution_id, region_id, app_type, route_code, route_snapshot,
                                     programme, academic_year, status, submitted_at, submitted_by, demo_tag)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'in_progress',%s,%s,%s)""",
        (app_id, ref_no, inst["id"], inst["region_id"], app_type, route_code, stages, programme, academic_year,
         now, actor["id"], demo_tag),
    )
    record(conn, at=now, actor=actor, action="application.submitted", entity_type="application", entity_id=app_id,
           application_id=app_id,
           details={"ref_no": ref_no, "type": app_type, "route": route_code, "stages": stages, "programme": programme})
    app = get_application(conn, app_id, lock=True)
    _start_stage(conn, now, app, seq=1, attempt=1)
    return app_id


def _start_stage(conn: Conn, now: datetime, app: dict, seq: int, attempt: int) -> dict:
    code = app["route_snapshot"][seq - 1]
    days = stage_sla_days(conn, code)
    due = due_after(now, days)
    substatus = {
        "intake": "in_review", "scrutiny": "in_review", "evc": "assignment_pending",
        "sac": "awaiting_recommendation", "decision": "awaiting_decision",
    }[code]
    stage_id = conn.val(
        """INSERT INTO application_stages (application_id, seq, stage_code, attempt, status, substatus, started_at, due_at)
           VALUES (%s,%s,%s,%s,'active',%s,%s,%s) RETURNING id""",
        (app["id"], seq, code, attempt, substatus, now, due),
    )
    conn.run("UPDATE applications SET current_stage_id = %s WHERE id = %s", (stage_id, app["id"]))
    app["current_stage_id"] = stage_id
    record(conn, at=now, actor=None, action="stage.started", entity_type="stage", entity_id=stage_id,
           application_id=app["id"],
           details={"stage": code, "seq": seq, "attempt": attempt, "sla_days": days,
                    "due_date": ist_date(due).isoformat(), "route": app["route_code"]})
    stage = conn.one("SELECT * FROM application_stages WHERE id = %s", (stage_id,))

    if code in REVIEW_STAGES:
        officer = pick_by_workload(conn, app["region_id"])
        if officer:
            _assign(conn, now, None, app, stage, officer, method="workload")
    elif code == "decision":
        director = region_director(conn, app["region_id"])
        if director:
            _assign(conn, now, None, app, stage, director, method="competent_authority")
    elif code == "evc":
        from app.scheduling import create_visit

        officer = pick_by_workload(conn, app["region_id"])
        if officer:
            _assign(conn, now, None, app, stage, officer, method="workload")
        create_visit(conn, now, app, stage)
    elif code == "sac":
        from app.workflow.committee import open_review

        open_review(conn, now, app, stage)

    if seq > 1:
        notifications.notify(conn, now=now, user_ids=institution_users(conn, app["institution_id"]),
                             template_code="event.stage_moved", ctx=_ctx(app, stage=stage_name(conn, code)),
                             link=_link(app), kind="update")
    return stage


def finish_stage(conn: Conn, now: datetime, actor: dict | None, app: dict, stage: dict, remarks: str | None) -> None:
    """Mark the current stage completed and route the case to the next stage of its route."""
    ensure(stage["status"] == "active", "This stage is not active.")
    conn.run(
        """UPDATE application_stages SET status = 'completed', substatus = 'completed', completed_at = %s,
                  completed_by = %s, remarks = %s WHERE id = %s""",
        (now, actor["id"] if actor else None, remarks, stage["id"]),
    )
    record(conn, at=now, actor=actor, action="stage.completed", entity_type="stage", entity_id=stage["id"],
           application_id=app["id"],
           details={"stage": stage["stage_code"], "seq": stage["seq"], "remarks": remarks,
                    "on_time": ist_date(now) <= ist_date(stage["due_at"])})
    route = app["route_snapshot"]
    if stage["seq"] < len(route):
        nxt = stage["seq"] + 1
        attempt = (conn.val("SELECT max(attempt) FROM application_stages WHERE application_id = %s AND seq = %s",
                            (app["id"], nxt)) or 0) + 1
        record(conn, at=now, actor=None, action="application.routed", entity_type="application", entity_id=app["id"],
               application_id=app["id"],
               details={"from": stage["stage_code"], "to": route[nxt - 1], "seq": nxt, "route": app["route_code"]})
        _start_stage(conn, now, app, seq=nxt, attempt=attempt)


def complete_review(conn: Conn, now: datetime, actor: dict, app_id: int, remarks: str | None = None) -> None:
    """Officer finishes the completeness check or (re-)scrutiny and the case moves on automatically."""
    ensure(actor["role"] == "official", "Only officials can complete scrutiny.", NotAllowed)
    app = get_application(conn, app_id, lock=True)
    ensure(app["status"] == "in_progress", "This application is already decided.")
    stage = current_stage(conn, app)
    ensure(stage["stage_code"] in REVIEW_STAGES,
           f"The case is at {stage['stage_name']}; this action only applies to the completeness check or scrutiny.")
    ensure(stage["substatus"] in ("in_review", "re_review"),
           "The case is waiting for the institution's reply to a deficiency.")
    finish_stage(conn, now, actor, app, stage, (remarks or "").strip() or None)


# ------------------------------------------------------------------ deficiency loop
def raise_deficiency(conn: Conn, now: datetime, actor: dict, app_id: int, reason: str,
                     response_days: int | None = None) -> int:
    ensure(actor["role"] == "official", "Only officials can return an application.", NotAllowed)
    reason = require_text(reason, "Reason for returning the application")
    app = get_application(conn, app_id, lock=True)
    ensure(app["status"] == "in_progress", "This application is already decided.")
    stage = current_stage(conn, app)
    ensure(stage["stage_code"] in REVIEW_STAGES,
           "Applications can be returned with a deficiency only during the completeness check or scrutiny.")
    ensure(stage["substatus"] in ("in_review", "re_review"), "A deficiency is already open on this application.")
    days = int(response_days or sla_days(conn, "deficiency_response"))
    ensure(1 <= days <= 60, "Response time must be between 1 and 60 days.", Invalid)
    due = due_after(now, days)
    def_id = conn.val(
        """INSERT INTO deficiencies (application_id, stage_id, raised_by, raised_at, reason, response_due_at, status)
           VALUES (%s,%s,%s,%s,%s,%s,'open') RETURNING id""",
        (app["id"], stage["id"], actor["id"], now, reason, due),
    )
    conn.run("UPDATE application_stages SET substatus = 'awaiting_institution', paused_at = %s WHERE id = %s",
             (now, stage["id"]))
    record(conn, at=now, actor=actor, action="deficiency.raised", entity_type="deficiency", entity_id=def_id,
           application_id=app["id"],
           details={"stage": stage["stage_code"], "reason": reason, "response_due": ist_date(due).isoformat(),
                    "sla_clock": "paused"})
    notifications.notify(conn, now=now, user_ids=institution_users(conn, app["institution_id"]),
                         template_code="event.deficiency_raised",
                         ctx=_ctx(app, reason=reason, due_date=fmt_date(due)), link=_link(app), kind="action", sms=True)
    return def_id


def respond_deficiency(conn: Conn, now: datetime, actor: dict, deficiency_id: int, response_text: str,
                       file_ids: list[int] | None = None) -> None:
    ensure(actor["role"] == "institution", "Only the institution can reply to a deficiency.", NotAllowed)
    d = conn.one("SELECT * FROM deficiencies WHERE id = %s FOR UPDATE", (deficiency_id,))
    if d is None:
        raise NotFound("Deficiency not found.")
    app = get_application(conn, d["application_id"], lock=True)
    ensure(app["institution_id"] == actor["institution_id"], "This application belongs to another institution.", NotAllowed)
    ensure(d["status"] == "open", "This deficiency has already been answered.")
    text = require_text(response_text, "Reply")
    stage = conn.one("SELECT * FROM application_stages WHERE id = %s FOR UPDATE", (d["stage_id"],))
    paused_for = now - stage["paused_at"] if stage["paused_at"] else None
    conn.run("""UPDATE deficiencies SET status = 'responded', responded_at = %s, responded_by = %s, response_text = %s
                WHERE id = %s""", (now, actor["id"], text, d["id"]))
    if paused_for is not None:
        conn.run(
            """UPDATE application_stages SET substatus = 're_review', paused_at = NULL,
                      paused_seconds = paused_seconds + %s, due_at = due_at + %s WHERE id = %s""",
            (int(paused_for.total_seconds()), paused_for, stage["id"]),
        )
    new_due = conn.val("SELECT due_at FROM application_stages WHERE id = %s", (stage["id"],))
    record(conn, at=now, actor=actor, action="deficiency.responded", entity_type="deficiency", entity_id=d["id"],
           application_id=app["id"],
           details={"reply": text, "files": file_ids or [], "sla_clock": "resumed",
                    "paused_days": round(paused_for.total_seconds() / 86400, 1) if paused_for else 0,
                    "stage_due": ist_date(new_due).isoformat()})
    notifications.notify(conn, now=now, user_ids=[stage["assigned_to"]], template_code="event.deficiency_answered",
                         ctx=_ctx(app), link=_link(app), kind="task")


# ------------------------------------------------------------------ revert
def revert(conn: Conn, now: datetime, actor: dict, app_id: int, to_stage: str, reason: str) -> None:
    """Send a case back to an earlier completeness check or scrutiny stage, with a reason."""
    ensure(actor["role"] == "official", "Only officials can send a case back.", NotAllowed)
    reason = require_text(reason, "Reason for sending the case back")
    app = get_application(conn, app_id, lock=True)
    ensure(app["status"] == "in_progress", "This application is already decided.")
    stage = current_stage(conn, app)
    ensure(stage["stage_code"] in ("evc", "sac", "decision"),
           "Only cases at EVC, SAC/SHC or decision can be sent back to an earlier stage.")
    route = app["route_snapshot"]
    ensure(to_stage in REVIEW_STAGES and to_stage in route[: stage["seq"] - 1],
           "The case can only go back to a completeness check or scrutiny stage earlier in its route.", Invalid)
    to_seq = route.index(to_stage) + 1
    conn.run("UPDATE application_stages SET status = 'reverted', substatus = 'reverted', completed_at = %s, "
             "completed_by = %s, remarks = %s WHERE id = %s", (now, actor["id"], reason, stage["id"]))
    conn.run("UPDATE evc_visits SET status = 'cancelled', step_due_at = NULL WHERE stage_id = %s "
             "AND status <> 'reviewed'", (stage["id"],))
    conn.run("UPDATE committee_reviews SET status = 'cancelled' WHERE stage_id = %s AND status = 'pending'", (stage["id"],))
    record(conn, at=now, actor=actor, action="stage.reverted", entity_type="stage", entity_id=stage["id"],
           application_id=app["id"], details={"from": stage["stage_code"], "to": to_stage, "reason": reason})
    attempt = (conn.val("SELECT max(attempt) FROM application_stages WHERE application_id = %s AND seq = %s",
                        (app["id"], to_seq)) or 0) + 1
    _start_stage(conn, now, app, seq=to_seq, attempt=attempt)


# ------------------------------------------------------------------ decision (human only)
def record_decision(conn: Conn, now: datetime, actor: dict, app_id: int, outcome: str, reason: str,
                    undertakings: list[dict] | None = None) -> list[int]:
    """Record the competent authority's decision. Argus never decides; this only records a human decision."""
    ensure(can_decide(actor), "Only a competent authority (Regional Director or Bureau) can record a decision.", NotAllowed)
    ensure(outcome in DECISIONS, "Unknown decision outcome.", Invalid)
    reason = require_text(reason, "Reason for the decision")
    app = get_application(conn, app_id, lock=True)
    ensure(app["status"] == "in_progress", "A decision is already recorded on this application.")
    stage = current_stage(conn, app)
    ensure(stage["stage_code"] == "decision" and stage["status"] == "active",
           "A decision can be recorded only when the case has reached the decision stage.")
    undertakings = undertakings or []
    today = ist_date(now)
    if outcome == "approved_with_undertakings":
        ensure(1 <= len(undertakings) <= 10, "Add between 1 and 10 undertakings.", Invalid)
        for u in undertakings:
            require_text(u.get("condition"), "Undertaking condition")
            d = u.get("due_date")
            d = date.fromisoformat(d) if isinstance(d, str) else d
            ensure(isinstance(d, date) and today < d <= today + timedelta(days=730),
                   "Each undertaking needs a due date after today and within two years.", Invalid)
            u["due_date"] = d
    else:
        ensure(not undertakings, "Undertakings apply only to 'Approved with undertakings'.", Invalid)

    conn.run("""UPDATE application_stages SET status = 'completed', substatus = 'completed', completed_at = %s,
                       completed_by = %s, remarks = %s WHERE id = %s""", (now, actor["id"], reason, stage["id"]))
    conn.run("""UPDATE applications SET status = 'decided', decision = %s, decision_reason = %s, decided_at = %s,
                       decided_by = %s WHERE id = %s""", (outcome, reason, now, actor["id"], app["id"]))
    record(conn, at=now, actor=actor, action="decision.recorded", entity_type="application", entity_id=app["id"],
           application_id=app["id"],
           details={"outcome": outcome, "reason": reason, "undertakings": len(undertakings),
                    "recorded_by": actor["name"], "human_decision": True})
    from app.compliance import create_undertaking

    ids = [create_undertaking(conn, now, actor, app, u["condition"].strip(), end_of_day(u["due_date"]))
           for u in undertakings]
    notifications.notify(conn, now=now, user_ids=institution_users(conn, app["institution_id"]),
                         template_code="event.decision", ctx=_ctx(app, outcome=DECISIONS[outcome]),
                         link=_link(app), kind="update", sms=True)
    return ids
