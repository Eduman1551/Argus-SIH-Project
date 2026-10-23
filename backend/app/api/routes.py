"""HTTP routes (all under /api). Each request runs in one database transaction; every state change
and its audit entry commit together. Scope is enforced here and in the engines."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import clock, compliance, documents, kpi, llm, notifications, reports, rules, scheduling, workflow
from app.alerts import maybe_tick, run_alert_tick
from app.api import dashboards
from app.api.cases import case_detail
from app.audit import record, verify_chain
from app.auth import (
    COOKIE,
    NotSignedIn,
    can_upload,
    ensure_application,
    load_user,
    public_user,
    require_bureau,
    require_role,
    sign,
    unsign,
)
from app.common import Invalid, NotAllowed, NotFound, ensure
from app.config import get_settings
from app.workflow import committee
from app.workflow.facts import case_facts
from db import Conn, transaction

router = APIRouter(prefix="/api")


@contextmanager
def tx(request: Request, signed_in: bool = True) -> Iterator[tuple[Conn, dict | None]]:
    with transaction() as c:
        user = load_user(c, request.cookies.get(COOKIE)) if signed_in else None
        yield c, user


def _region_scope(user: dict) -> int | None:
    """Regional officers see their Region by default; Bureau officers see all Regions."""
    return user["region_id"] if user["role"] == "official" and user["official_kind"] == "regional" else None


# ================================================================== session, clock, live
class SessionIn(BaseModel):
    user_id: int


@router.get("/health")
def health():
    with transaction() as c:
        c.val("SELECT 1")
    return {"ok": True, "llm": llm.llm_available()}


@router.get("/users/demo")
def demo_users():
    with transaction() as c:
        rows = c.all("""SELECT u.id, u.code, u.name, u.role, u.designation, u.featured, u.official_kind, u.rank,
                               u.committee_kind, i.name AS institution, r.name AS region
                        FROM users u LEFT JOIN institutions i ON i.id = u.institution_id
                        LEFT JOIN regions r ON r.id = COALESCE(u.region_id, i.region_id)
                        ORDER BY u.featured DESC, u.role, u.official_kind DESC NULLS LAST, u.rank NULLS LAST,
                                 u.committee_kind NULLS LAST, u.name""")
    return {"users": rows, "note": "Demo sign-in. Real login and SSO are future scope."}


@router.get("/session")
def get_session(request: Request):
    try:
        with tx(request) as (c, user):
            return {"user": public_user(user), "unread": notifications.unread_count(c, user["id"])}
    except NotSignedIn:
        return {"user": None, "unread": 0}


@router.post("/session")
def set_session(body: SessionIn, response: Response):
    with transaction() as c:
        user = c.one("SELECT id FROM users WHERE id = %s", (body.user_id,))
        if user is None:
            raise NotFound("Unknown demo user.")
    response.set_cookie(COOKIE, sign(body.user_id), httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30,
                        secure=False, path="/")
    return {"ok": True}


@router.delete("/session")
def end_session(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/live")
def live(request: Request):
    """Polled every few seconds. Runs the alert tick when due (guarded) and returns what changed."""
    uid = unsign(request.cookies.get(COOKIE))
    with transaction() as c:
        tick = maybe_tick(c)
        row = c.one(
            """SELECT (SELECT COALESCE(max(id), 0) FROM audit_log) AS version,
                      (SELECT count(*) FROM notifications WHERE user_id = %s AND read_at IS NULL) AS unread""",
            (uid,))
        return {"clock": clock.state(c), "version": row["version"], "unread": row["unread"] if uid else 0,
                "ticked": bool(tick and (tick["alerts"] or tick["resolved"] or any(tick["delivery"].values())))}


@router.get("/clock")
def get_clock():
    with transaction() as c:
        return clock.state(c)


class AdvanceIn(BaseModel):
    days: int = Field(ge=1, le=clock.MAX_ADVANCE_DAYS)


@router.post("/clock/advance")
def advance(body: AdvanceIn, request: Request):
    with tx(request) as (c, user):
        result = clock.advance(c, body.days, user)
        result["clock"] = clock.state(c)
        return result


@router.post("/demo/reset")
def demo_reset(request: Request):
    from app.data.snapshot import restore

    with tx(request) as (c, user):
        restore(c)
        record(c, at=clock.now(c), actor=None, action="demo.reset", entity_type="dataset", entity_id="synthetic",
               details={"requested_by": user["name"]})
        return {"ok": True, "clock": clock.state(c)}


@router.get("/cron/tick")
def cron_tick(request: Request):
    secret = get_settings().cron_secret
    if secret and request.headers.get("authorization") != f"Bearer {secret}":
        return JSONResponse({"detail": "Unauthorised"}, status_code=401)
    with transaction() as c:
        return run_alert_tick(c, clock.now(c))


# ================================================================== dashboards
@router.get("/dashboard")
def dashboard(request: Request, region_id: int | None = None, all_regions: bool = False):
    with tx(request) as (c, user):
        now = clock.now(c)
        if user["role"] == "institution":
            return {"role": "institution", **dashboards.institution_home(c, now, user["institution_id"])}
        if user["role"] == "committee":
            return {"role": "committee", **dashboards.committee_cases(c, now, user["id"])}
        scope = None if all_regions else (region_id or _region_scope(user))
        return {"role": "official", **dashboards.official_dashboard(c, now, scope)}


@router.get("/regions")
def regions():
    with transaction() as c:
        return c.all("SELECT id, code, name FROM regions ORDER BY id")


# ================================================================== applications
class SubmitIn(BaseModel):
    app_type: str
    programme: str
    academic_year: str = "2026-27"


@router.get("/application-types")
def application_types():
    with transaction() as c:
        rows = c.all("""SELECT t.code, t.name, t.route_code, r.name AS route_name FROM application_types t
                        JOIN routes r ON r.code = t.route_code ORDER BY t.name""")
        for r in rows:
            r["stages"] = [c.val("SELECT name FROM stages WHERE code = %s", (s,))
                           for s in rules.route_stage_codes(c, r["route_code"])]
        return rows


@router.get("/applications")
def list_applications(request: Request, status: str | None = None, region_id: int | None = None,
                      stage: str | None = None, sla: str | None = None, q: str | None = None):
    with tx(request) as (c, user):
        require_role(user, "official", "institution")
        now = clock.now(c)
        inst = user["institution_id"] if user["role"] == "institution" else None
        pend = {p["id"]: p for p in reports.pendency(c, now, region_id, inst)}
        rows = c.all(
            """SELECT a.id, a.ref_no, a.status, a.decision, a.submitted_at, a.decided_at, a.programme,
                      i.name AS institution, r.name AS region, r.id AS region_id, t.name AS type_name,
                      s.stage_code, st.name AS stage_name
               FROM applications a JOIN institutions i ON i.id = a.institution_id JOIN regions r ON r.id = a.region_id
               JOIN application_types t ON t.code = a.app_type JOIN application_stages s ON s.id = a.current_stage_id
               JOIN stages st ON st.code = s.stage_code
               WHERE (%(i)s::int IS NULL OR a.institution_id = %(i)s) AND (%(r)s::int IS NULL OR a.region_id = %(r)s)
                 AND (%(st)s::text IS NULL OR a.status = %(st)s) AND (%(sg)s::text IS NULL OR s.stage_code = %(sg)s)
                 AND (%(q)s::text IS NULL OR a.ref_no ILIKE %(q)s OR i.name ILIKE %(q)s OR a.programme ILIKE %(q)s)
               ORDER BY a.submitted_at DESC""",
            {"i": inst, "r": region_id, "st": status, "sg": stage, "q": f"%{q}%" if q else None})
        out = []
        for r in rows:
            p = pend.get(r["id"])
            r.update({k: p[k] for k in ("sla_status", "substatus_text", "due_date", "days_to_due", "age_days",
                                        "waiting_on", "escalation_level", "assignee", "substatus", "stage_started",
                                        "stage_due", "days_in_stage", "stage_paused_days", "stage_paused_now",
                                        "stage_open_pause_days")} if p else
                     {"sla_status": "decided", "substatus_text": "Decided", "due_date": None, "days_to_due": None,
                      "age_days": None, "waiting_on": None, "escalation_level": None, "assignee": None,
                      "substatus": None, "stage_started": None, "stage_due": None, "days_in_stage": None,
                      "stage_paused_days": None, "stage_paused_now": None, "stage_open_pause_days": None})
            if sla and r["sla_status"] != sla:
                continue
            out.append(r)
        return {"rows": out, "total": len(out)}


@router.post("/applications")
def submit_application(body: SubmitIn, request: Request):
    with tx(request) as (c, user):
        app_id = workflow.submit_application(c, clock.now(c), user, app_type=body.app_type, programme=body.programme,
                                             academic_year=body.academic_year)
        return {"id": app_id, "ref_no": c.val("SELECT ref_no FROM applications WHERE id = %s", (app_id,))}


@router.get("/applications/{app_id}")
def get_application(app_id: int, request: Request):
    with tx(request) as (c, user):
        ensure_application(c, user, app_id)
        return case_detail(c, clock.now(c), user, app_id)


class RemarksIn(BaseModel):
    remarks: str | None = None


class ReasonIn(BaseModel):
    reason: str
    response_days: int | None = None


class RespondIn(BaseModel):
    deficiency_id: int
    response: str
    file_ids: list[int] = []


class AssignIn(BaseModel):
    user_id: int


class RevertIn(BaseModel):
    to_stage: str
    reason: str


class UndertakingIn(BaseModel):
    condition: str
    due_date: date


class DecisionIn(BaseModel):
    outcome: str
    reason: str
    undertakings: list[UndertakingIn] = []


@router.post("/applications/{app_id}/complete")
def complete_review(app_id: int, body: RemarksIn, request: Request):
    with tx(request) as (c, user):
        workflow.complete_review(c, clock.now(c), user, app_id, body.remarks)
        return {"ok": True}


@router.post("/applications/{app_id}/deficiency")
def raise_deficiency(app_id: int, body: ReasonIn, request: Request):
    with tx(request) as (c, user):
        return {"id": workflow.raise_deficiency(c, clock.now(c), user, app_id, body.reason, body.response_days)}


@router.post("/applications/{app_id}/respond")
def respond(app_id: int, body: RespondIn, request: Request):
    with tx(request) as (c, user):
        ensure_application(c, user, app_id)
        ensure(c.val("SELECT application_id FROM deficiencies WHERE id = %s", (body.deficiency_id,)) == app_id,
               "This deficiency is not on this application.", Invalid)
        for fid in body.file_ids:
            f = c.one("SELECT entity_type, entity_id FROM files WHERE id = %s", (fid,))
            ensure(f is not None and f["entity_type"] == "deficiency" and f["entity_id"] == body.deficiency_id,
                   "An attached file does not belong to this reply.", Invalid)
        workflow.respond_deficiency(c, clock.now(c), user, body.deficiency_id, body.response, body.file_ids)
        return {"ok": True}


@router.post("/applications/{app_id}/assign")
def assign(app_id: int, body: AssignIn, request: Request):
    with tx(request) as (c, user):
        workflow.reassign(c, clock.now(c), user, app_id, body.user_id)
        return {"ok": True}


@router.post("/applications/{app_id}/revert")
def revert(app_id: int, body: RevertIn, request: Request):
    with tx(request) as (c, user):
        workflow.revert(c, clock.now(c), user, app_id, body.to_stage, body.reason)
        return {"ok": True}


@router.post("/applications/{app_id}/decision")
def decision(app_id: int, body: DecisionIn, request: Request):
    with tx(request) as (c, user):
        ids = workflow.record_decision(c, clock.now(c), user, app_id, body.outcome, body.reason,
                                       [u.model_dump() for u in body.undertakings])
        return {"ok": True, "undertakings": ids}


class LetterIn(BaseModel):
    kind: str = "deficiency"
    reason: str | None = None
    use_llm: bool = True


@router.post("/applications/{app_id}/draft-letter")
def draft_letter(app_id: int, body: LetterIn, request: Request):
    with tx(request) as (c, user):
        require_role(user, "official")
        ensure(body.kind in ("deficiency", "reminder"), "Unknown letter type.", Invalid)
        facts = case_facts(c, app_id, clock.now(c))
        facts["reason"] = body.reason
        facts["due"] = None
        text, source = llm.draft_letter(body.kind, facts, use_llm=body.use_llm)
        return {"text": text, "source": source, "label": llm.DRAFT_LABEL}


# ================================================================== queue
@router.get("/queue")
def queue(request: Request):
    with tx(request) as (c, user):
        require_role(user, "official")
        now = clock.now(c)
        scope = _region_scope(user)
        pend = reports.pendency(c, now, scope)
        mine = [p for p in pend if p["assigned_to"] == user["id"] and p["waiting_on"] != "institution"
                and not (p["stage_code"] == "evc" and p["substatus"] in ("availability_pending", "scheduled", "report_pending"))]
        evidence = [u for u in reports.undertakings(c, now, scope, include_closed=False)
                    if u["state"] == "awaiting_verification"]
        renewals = [d for d in reports.documents(c, now, scope) if d["state"] == "renewal_submitted"]
        team = c.all(
            """SELECT u.id, u.name, u.designation,
                      (SELECT count(*) FROM application_stages s WHERE s.assigned_to = u.id AND s.status = 'active') AS active,
                      (SELECT count(*) FROM application_stages s WHERE s.assigned_to = u.id AND s.status = 'active'
                         AND s.paused_at IS NULL AND ist_date(s.due_at) < %(t)s) AS overdue
               FROM users u WHERE u.role = 'official' AND (%(r)s::int IS NULL OR u.region_id = %(r)s)
               ORDER BY u.official_kind DESC, u.rank, u.name""", {"t": clock.today(c), "r": scope})
        dash = dashboards.official_dashboard(c, now, scope)
        return {"mine": mine, "unassigned": dash["unassigned"], "evidence": evidence, "renewals": renewals,
                "team": team, "waiting_on_others": [p for p in pend if p["assigned_to"] == user["id"] and p not in mine]}


# ================================================================== EVC
class MembersIn(BaseModel):
    member_ids: list[int]
    convenor_id: int


class AvailabilityIn(BaseModel):
    available: bool
    dates: list[date] = []


class ScheduleIn(BaseModel):
    visit_date: date


class ReportIn(BaseModel):
    findings: str
    recommendation: str
    file_id: int | None = None


@router.get("/evc/board")
def evc_board(request: Request, all_regions: bool = False):
    with tx(request) as (c, user):
        require_role(user, "official")
        scope = None if all_regions else _region_scope(user)
        rows = [v for v in scheduling.board(c, clock.now(c)) if scope is None or v["region_id"] == scope]
        return {"visits": rows, "window_days": rules.setting(c, "evc_due_window_days")}


@router.get("/visits/{visit_id}")
def get_visit(visit_id: int, request: Request):
    with tx(request) as (c, user):
        v = c.one("SELECT application_id FROM evc_visits WHERE id = %s", (visit_id,))
        if v is None:
            raise NotFound("Visit not found.")
        if user["role"] == "committee" and not scheduling.is_member(c, visit_id, user["id"]):
            raise NotAllowed("You are not on this visit committee.")
        ensure_application(c, user, v["application_id"])
        detail = case_detail(c, clock.now(c), user, v["application_id"])
        return {"visit_id": visit_id, **detail}


@router.post("/visits/{visit_id}/members")
def visit_members(visit_id: int, body: MembersIn, request: Request):
    with tx(request) as (c, user):
        scheduling.assign_members(c, clock.now(c), user, visit_id, body.member_ids, body.convenor_id)
        return {"ok": True}


@router.post("/visits/{visit_id}/availability")
def visit_availability(visit_id: int, body: AvailabilityIn, request: Request):
    with tx(request) as (c, user):
        scheduling.respond_availability(c, clock.now(c), user, visit_id, body.available, body.dates)
        return {"ok": True}


@router.post("/visits/{visit_id}/schedule")
def visit_schedule(visit_id: int, body: ScheduleIn, request: Request):
    with tx(request) as (c, user):
        scheduling.schedule_visit(c, clock.now(c), user, visit_id, body.visit_date)
        return {"ok": True}


@router.post("/visits/{visit_id}/conducted")
def visit_conducted(visit_id: int, request: Request):
    with tx(request) as (c, user):
        scheduling.mark_conducted(c, clock.now(c), user, visit_id)
        return {"ok": True}


@router.post("/visits/{visit_id}/report")
def visit_report(visit_id: int, body: ReportIn, request: Request):
    with tx(request) as (c, user):
        if body.file_id is not None:
            f = c.one("SELECT entity_type, entity_id FROM files WHERE id = %s", (body.file_id,))
            ensure(f is not None and f["entity_type"] == "evc_visit" and f["entity_id"] == visit_id,
                   "The attached file does not belong to this visit.", Invalid)
        scheduling.submit_report(c, clock.now(c), user, visit_id, body.findings, body.recommendation, body.file_id)
        return {"ok": True}


@router.post("/visits/{visit_id}/review")
def visit_review(visit_id: int, body: RemarksIn, request: Request):
    with tx(request) as (c, user):
        scheduling.review_report(c, clock.now(c), user, visit_id, body.remarks)
        return {"ok": True}


# ================================================================== committee (SAC/SHC)
class RecommendIn(BaseModel):
    recommendation: str
    remarks: str


class SummaryIn(BaseModel):
    use_llm: bool = True


class CommitteeMembersIn(BaseModel):
    member_ids: list[int]


@router.post("/reviews/{review_id}/recommend")
def recommend(review_id: int, body: RecommendIn, request: Request):
    with tx(request) as (c, user):
        committee.recommend(c, clock.now(c), user, review_id, body.recommendation, body.remarks)
        return {"ok": True}


@router.post("/reviews/{review_id}/summary")
def regenerate_summary(review_id: int, body: SummaryIn, request: Request):
    with tx(request) as (c, user):
        result = committee.regenerate_summary(c, clock.now(c), user, review_id, body.use_llm)
        return {**result, "label": llm.DRAFT_LABEL}


@router.post("/reviews/{review_id}/members")
def review_members(review_id: int, body: CommitteeMembersIn, request: Request):
    with tx(request) as (c, user):
        committee.reassign_members(c, clock.now(c), user, review_id, body.member_ids)
        return {"ok": True}


# ================================================================== compliance and validity
class EvidenceIn(BaseModel):
    file_id: int | None = None
    note: str = ""


class VerifyIn(BaseModel):
    accept: bool
    remarks: str | None = None


class RenewalIn(BaseModel):
    file_id: int
    new_expiry: date


@router.get("/undertakings")
def list_undertakings(request: Request, all_regions: bool = False):
    with tx(request) as (c, user):
        require_role(user, "official", "institution")
        now = clock.now(c)
        if user["role"] == "institution":
            rows = reports.undertakings(c, now, institution_id=user["institution_id"])
        else:
            rows = reports.undertakings(c, now, None if all_regions else _region_scope(user))
        files = documents.list_for(c, "undertaking", [u["id"] for u in rows]) if rows else []
        for u in rows:
            u["files"] = [f for f in files if f["entity_id"] == u["id"]]
        return {"rows": rows}


@router.post("/undertakings/{uid}/evidence")
def submit_evidence(uid: int, body: EvidenceIn, request: Request):
    with tx(request) as (c, user):
        compliance.submit_evidence(c, clock.now(c), user, uid, body.file_id, body.note)
        return {"ok": True}


@router.post("/undertakings/{uid}/verify")
def verify_evidence(uid: int, body: VerifyIn, request: Request):
    with tx(request) as (c, user):
        compliance.review_evidence(c, clock.now(c), user, uid, body.accept, body.remarks)
        return {"ok": True}


@router.get("/tracked-documents")
def list_documents(request: Request, all_regions: bool = False):
    with tx(request) as (c, user):
        require_role(user, "official", "institution")
        now = clock.now(c)
        if user["role"] == "institution":
            rows = reports.documents(c, now, institution_id=user["institution_id"])
        else:
            rows = reports.documents(c, now, None if all_regions else _region_scope(user))
        return {"rows": rows, "expiring_soon_days": rules.setting(c, "expiring_soon_days")}


@router.post("/tracked-documents/{doc_id}/renewal")
def submit_renewal(doc_id: int, body: RenewalIn, request: Request):
    with tx(request) as (c, user):
        compliance.submit_renewal(c, clock.now(c), user, doc_id, body.file_id, body.new_expiry)
        return {"ok": True}


@router.post("/tracked-documents/{doc_id}/verify")
def verify_renewal(doc_id: int, body: VerifyIn, request: Request):
    with tx(request) as (c, user):
        compliance.review_renewal(c, clock.now(c), user, doc_id, body.accept, body.remarks)
        return {"ok": True}


# ================================================================== files
@router.post("/files")
async def upload_file(request: Request, entity_type: str = Form(...), entity_id: int = Form(...),
                      slot: str = Form("attachment"), file: UploadFile = File(...)):
    data = await file.read(documents.MAX_BYTES + 1)
    with tx(request) as (c, user):
        inst_id, app_id = can_upload(c, user, entity_type, entity_id)
        return documents.store(c, clock.now(c), user, entity_type=entity_type, entity_id=entity_id,
                               slot=slot[:40], filename=file.filename or "file",
                               content_type=file.content_type or "", data=data, institution_id=inst_id,
                               application_id=app_id)


@router.get("/files/{file_id}")
def download_file(file_id: int, request: Request):
    with tx(request) as (c, user):
        f = documents.load(c, user, file_id)
    return Response(content=bytes(f["data"]), media_type=f["content_type"],
                    headers={"Content-Disposition": f'attachment; filename="{f["filename"]}"',
                             "X-Content-SHA256": f["sha256"]})


# ================================================================== escalations, notifications
@router.get("/escalations")
def list_escalations(request: Request, all_regions: bool = False):
    with tx(request) as (c, user):
        require_role(user, "official")
        scope = None if all_regions else _region_scope(user)
        rows = c.all(
            """SELECT e.id, e.entity_type, e.entity_id, e.level, e.due_date, e.escalated_at, e.status, e.resolved_at,
                      a.title, a.application_id, ap.ref_no, i.name AS institution, r.name AS region, t.name AS target,
                      l.title AS level_title, (%(today)s - e.due_date) AS days_overdue
               FROM escalations e JOIN alerts a ON a.id = e.alert_id
               LEFT JOIN applications ap ON ap.id = a.application_id
               LEFT JOIN institutions i ON i.id = a.institution_id LEFT JOIN regions r ON r.id = a.region_id
               LEFT JOIN users t ON t.id = e.target_user_id LEFT JOIN escalation_levels l ON l.level = e.level
               WHERE (%(r)s::int IS NULL OR a.region_id = %(r)s)
               ORDER BY e.status, e.level DESC, e.escalated_at DESC""", {"r": scope, "today": clock.today(c)})
        # one row per item at its highest open level
        open_items: dict[tuple, dict] = {}
        history: dict[tuple, list] = {}
        for e in rows:
            if e["status"] != "open":
                continue
            key = (e["entity_type"], e["entity_id"])
            history.setdefault(key, []).append({"level": e["level"], "escalated_at": e["escalated_at"], "target": e["target"]})
            if key not in open_items or e["level"] > open_items[key]["level"]:
                open_items[key] = e
        for key, e in open_items.items():
            e["history"] = sorted(history[key], key=lambda h: h["level"])
        resolved = [e for e in rows if e["status"] == "resolved"][:40]
        return {"open": sorted(open_items.values(), key=lambda e: (-e["level"], -e["days_overdue"])),
                "resolved": resolved, "levels": c.all("SELECT * FROM escalation_levels ORDER BY level")}


@router.get("/notifications")
def list_notifications(request: Request, unread: bool = False):
    with tx(request) as (c, user):
        rows = c.all("""SELECT id, kind, title, body, link, created_at, read_at, alert_id FROM notifications
                        WHERE user_id = %s AND (NOT %s OR read_at IS NULL) ORDER BY id DESC LIMIT 200""",
                     (user["id"], unread))
        return {"rows": rows, "unread": notifications.unread_count(c, user["id"])}


@router.post("/notifications/{nid}/read")
def read_notification(nid: int, request: Request):
    with tx(request) as (c, user):
        c.run("UPDATE notifications SET read_at = %s WHERE id = %s AND user_id = %s AND read_at IS NULL",
              (clock.now(c), nid, user["id"]))
        return {"ok": True}


@router.post("/notifications/read-all")
def read_all(request: Request):
    with tx(request) as (c, user):
        n = c.run("UPDATE notifications SET read_at = %s WHERE user_id = %s AND read_at IS NULL",
                  (clock.now(c), user["id"]))
        return {"ok": True, "marked": n}


@router.get("/outbox")
def outbox(request: Request, everyone: bool = False, channel: str | None = None, status: str | None = None):
    with tx(request) as (c, user):
        if everyone:
            require_role(user, "official")
        rows = c.all(
            """SELECT o.id, o.channel, o.address, o.subject, o.body, o.status, o.status_reason, o.created_at,
                      o.updated_at, u.name AS recipient FROM outbox o JOIN users u ON u.id = o.user_id
               WHERE (%(all)s OR o.user_id = %(u)s) AND (%(ch)s::text IS NULL OR o.channel = %(ch)s)
                 AND (%(st)s::text IS NULL OR o.status = %(st)s)
               ORDER BY o.id DESC LIMIT 200""",
            {"all": everyone, "u": user["id"], "ch": channel, "st": status})
        counts = c.all("""SELECT channel, status, count(*) AS n FROM outbox WHERE (%s OR user_id = %s)
                          GROUP BY 1, 2 ORDER BY 1, 2""", (everyone, user["id"]))
        return {"rows": rows, "counts": counts, "note": "Simulated delivery. No real email or SMS is sent."}


# ================================================================== reports, audit, KPIs
@router.get("/reports")
def report_list():
    return [{"name": k, "title": v} for k, v in reports.REPORTS.items()]


@router.get("/reports/{name}")
def report(name: str, request: Request, region_id: int | None = None, format: str = Query("json")):
    with tx(request) as (c, user):
        require_role(user, "official")
        if name not in reports.REPORTS:
            raise NotFound("Unknown report.")
        data = reports.build(c, clock.now(c), name, region_id)
    if format == "csv":
        return Response(content=reports.to_csv(data), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="argus-{name}-report.csv"'})
    return data


@router.get("/audit")
def audit_log(request: Request, action: str | None = None, application_id: int | None = None,
              q: str | None = None, before: int | None = None, limit: int = Query(100, le=500)):
    with tx(request) as (c, user):
        require_role(user, "official")
        rows = c.all(
            """SELECT a.id, a.at, a.actor_label, a.actor_id, a.action, a.entity_type, a.entity_id, a.application_id,
                      a.details, a.prev_hash, a.hash, ap.ref_no
               FROM audit_log a LEFT JOIN applications ap ON ap.id = a.application_id
               WHERE (%(ac)s::text IS NULL OR a.action LIKE %(ac)s) AND (%(ap)s::int IS NULL OR a.application_id = %(ap)s)
                 AND (%(q)s::text IS NULL OR a.actor_label ILIKE %(q)s OR ap.ref_no ILIKE %(q)s
                      OR a.details::text ILIKE %(q)s)
                 AND (%(b)s::bigint IS NULL OR a.id < %(b)s)
               ORDER BY a.id DESC LIMIT %(l)s""",
            {"ac": f"{action}%" if action else None, "ap": application_id, "q": f"%{q}%" if q else None,
             "b": before, "l": limit})
        total = c.val("SELECT count(*) FROM audit_log")
        actions = [r["action"] for r in c.all("SELECT DISTINCT split_part(action, '.', 1) AS action FROM audit_log ORDER BY 1")]
        return {"rows": rows, "total": total, "action_groups": actions}


@router.post("/audit/verify")
def audit_verify(request: Request):
    with tx(request) as (c, user):
        require_role(user, "official")
        return verify_chain(c)


@router.get("/kpi")
def kpis(request: Request):
    with tx(request) as (c, _user):
        return kpi.compute(c, clock.now(c))


@router.post("/kpi/routing-selftest")
def routing_selftest(request: Request):
    from app.kpi.selftest import run_routing_selftest

    with tx(request) as (c, _user):
        return run_routing_selftest(c)


# ================================================================== rules (Bureau only for edits)
class SlaIn(BaseModel):
    days: int


class RouteIn(BaseModel):
    stages: list[str]


class AppTypeIn(BaseModel):
    route_code: str


class RemindersIn(BaseModel):
    offsets: list[int]
    overdue: int


class EscDaysIn(BaseModel):
    days: list[int]


class EscLevelIn(BaseModel):
    title: str
    target: str


class TemplateIn(BaseModel):
    subject: str
    body: str
    sms: str


class SettingIn(BaseModel):
    value: int


@router.get("/rules")
def get_rules(request: Request):
    with tx(request) as (c, user):
        require_role(user, "official")
        return {**rules.get_all(c), "can_edit": user["official_kind"] == "bureau"}


def _rule_change(request: Request, fn, *args):
    with tx(request) as (c, user):
        require_bureau(user)
        fn(c, clock.now(c), user, *args)
        return rules.get_all(c)


@router.put("/rules/sla/{code}")
def put_sla(code: str, body: SlaIn, request: Request):
    return _rule_change(request, rules.update_sla, code, body.days)


@router.put("/rules/routes/{code}")
def put_route(code: str, body: RouteIn, request: Request):
    return _rule_change(request, rules.update_route, code, body.stages)


@router.put("/rules/application-types/{code}")
def put_app_type(code: str, body: AppTypeIn, request: Request):
    return _rule_change(request, rules.update_application_type, code, body.route_code)


@router.put("/rules/reminders/{entity_type}")
def put_reminders(entity_type: str, body: RemindersIn, request: Request):
    return _rule_change(request, rules.update_reminder_offsets, entity_type, body.offsets, body.overdue)


@router.put("/rules/escalation-days/{entity_type}")
def put_escalation_days(entity_type: str, body: EscDaysIn, request: Request):
    return _rule_change(request, rules.update_escalation_days, entity_type, body.days)


@router.put("/rules/escalation-levels/{level}")
def put_escalation_level(level: int, body: EscLevelIn, request: Request):
    return _rule_change(request, rules.update_escalation_level, level, body.title, body.target)


@router.put("/rules/templates/{code}")
def put_template(code: str, body: TemplateIn, request: Request):
    return _rule_change(request, rules.update_template, code, body.subject, body.body, body.sms)


@router.put("/rules/settings/{key}")
def put_setting(key: str, body: SettingIn, request: Request):
    return _rule_change(request, rules.update_setting, key, body.value)


# ================================================================== guided demo scenario
@router.get("/demo/scenario")
def scenario_steps():
    from app.data.demo import STEPS

    return [{"id": s["id"], "title": s["title"], "who": s["who"]} for s in STEPS]


@router.post("/demo/scenario/{step_id}")
def scenario_run(step_id: int, request: Request):
    from app.data.demo import run_step

    with tx(request, signed_in=False) as (c, _):
        return run_step(c, step_id)
