"""Guided demo scenario ("Run demo scenario" on the Guide page, and scripts/smoke.py).

Each step performs real engine actions on the scripted demo cases as the named demo user, and the
caption is built from what actually happened. Run the steps in order after a Reset.
"""

from __future__ import annotations

from app import clock, compliance, documents, kpi, workflow
from app.alerts import run_alert_tick
from app.audit import verify_chain
from app.common import InvalidAction, fmt_date
from db import Conn

STEPS = [
    {"id": 1, "title": "Institution submits a new application and Argus routes it", "who": "Ambervale Institute (institution)"},
    {"id": 2, "title": "Officer returns the case in scrutiny with a deficiency", "who": "Arjun Wrenfield (official)"},
    {"id": 3, "title": "Institution replies; the SLA clock resumes", "who": "Ambervale Institute (institution)"},
    {"id": 4, "title": "Officer completes re-scrutiny; the case moves to EVC by itself", "who": "Arjun Wrenfield (official)"},
    {"id": 5, "title": "Advance the clock 7 days: reminders, overdue alerts, escalations", "who": "Simulated clock"},
    {"id": 6, "title": "Advance 30 more days: lease expiry and escalation up the chain", "who": "Simulated clock"},
    {"id": 7, "title": "Institution uploads evidence; officer verifies and closes", "who": "Ambervale and Arjun Wrenfield"},
    {"id": 8, "title": "Verify the audit chain and read the KPIs", "who": "Any official"},
]


def _user(c: Conn, code: str) -> dict:
    return c.one("SELECT * FROM users WHERE code = %s", (code,))


def _case(c: Conn, tag: str) -> dict:
    return c.one("SELECT * FROM applications WHERE demo_tag = %s", (tag,))


def _stage(c: Conn, app_id: int) -> dict:
    return c.one("""SELECT s.*, st.name FROM applications a JOIN application_stages s ON s.id = a.current_stage_id
                    JOIN stages st ON st.code = s.stage_code WHERE a.id = %s""", (app_id,))


def _alert_summary(c: Conn, since_id: int) -> dict:
    rows = c.all("SELECT kind, level, title FROM alerts WHERE id > %s ORDER BY id", (since_id,))
    return {"reminders": sum(r["kind"] == "reminder" for r in rows),
            "overdue": sum(r["kind"] == "overdue" for r in rows),
            "escalations": [r["title"] for r in rows if r["kind"] == "escalation"],
            "examples": [r["title"] for r in rows[:6]]}


def run_step(c: Conn, step: int) -> dict:
    now = clock.now(c)
    inst, officer = _user(c, "inst-AMB"), _user(c, "off-NR-1")
    case = _case(c, "demo_scrutiny")

    if step == 1:
        app_id = workflow.submit_application(c, now, inst, app_type="NEW", programme="B.Tech Robotics (60 seats)",
                                             academic_year="2026-27")
        st = _stage(c, app_id)
        app = workflow.get_application(c, app_id)
        who = c.val("SELECT name FROM users WHERE id = %s", (st["assigned_to"],))
        route = " > ".join(c.val("SELECT name FROM stages WHERE code = %s", (s,)) for s in app["route_snapshot"])
        caption = (f"{app['ref_no']} was submitted. Its type routes it through: {route}. It is now at "
                   f"{st['name']}, assigned to {who} by workload, due {fmt_date(st['due_at'])}.")
        return {"step": 1, "caption": caption, "link": f"/applications/{app_id}"}

    if step == 2:
        if _stage(c, case["id"])["substatus"] != "in_review":
            raise InvalidAction("Step 2 needs a fresh demo case. Reset the demo data and start from step 1.")
        workflow.raise_deficiency(c, now, officer, case["id"],
                                  "Faculty list is short of the required cadre ratio. Upload revised faculty details.")
        d = c.one("SELECT * FROM deficiencies WHERE application_id = %s AND status = 'open'", (case["id"],))
        caption = (f"{case['ref_no']} was returned with a reason. The institution must reply by "
                   f"{fmt_date(d['response_due_at'])}. The AICTE SLA clock for scrutiny is now paused.")
        return {"step": 2, "caption": caption, "link": f"/applications/{case['id']}"}

    if step == 3:
        d = c.one("SELECT * FROM deficiencies WHERE application_id = %s AND status = 'open'", (case["id"],))
        if d is None:
            raise InvalidAction("Run step 2 first.")
        before = _stage(c, case["id"])["due_at"]
        clock.advance(c, 2, None)
        workflow.respond_deficiency(c, clock.now(c), inst, d["id"],
                                    "Revised faculty list with appointment letters is uploaded.")
        after = _stage(c, case["id"])["due_at"]
        caption = (f"Two days later Ambervale replied. The scrutiny due date moved from {fmt_date(before)} to "
                   f"{fmt_date(after)}: those days count as time waiting on the institution, not on AICTE.")
        return {"step": 3, "caption": caption, "link": f"/applications/{case['id']}"}

    if step == 4:
        st = _stage(c, case["id"])
        if st["substatus"] != "re_review":
            raise InvalidAction("Run step 3 first.")
        workflow.complete_review(c, now, officer, case["id"], "Re-scrutiny complete; faculty details now in order.")
        st = _stage(c, case["id"])
        caption = (f"Re-scrutiny was completed and {case['ref_no']} moved on its own to {st['name']}: the EVC queue "
                   f"now shows it waiting for committee members (assign by {fmt_date(st['due_at'])}).")
        return {"step": 4, "caption": caption, "link": "/evc"}

    if step in (5, 6):
        days = 7 if step == 5 else 30
        since = c.val("SELECT COALESCE(max(id), 0) FROM alerts")
        result = clock.advance(c, days, None)
        s = _alert_summary(c, since)
        caption = (f"The clock moved {days} days to {fmt_date(clock.now(c))}, one day at a time. The engine sent "
                   f"{s['reminders']} reminder(s), {s['overdue']} overdue alert(s) and {len(s['escalations'])} "
                   f"escalation(s), each once, on its configured day.")
        if s["escalations"]:
            caption += " For example: " + "; ".join(s["escalations"][:3]) + "."
        return {"step": step, "caption": caption, "result": result, "examples": s["examples"], "link": "/escalations"}

    if step == 7:
        u = c.one("""SELECT u.* FROM undertakings u JOIN applications a ON a.id = u.application_id
                     WHERE a.demo_tag = 'demo_legacy' AND u.status IN ('open', 'resubmission_requested')
                     ORDER BY u.due_at LIMIT 1""")
        if u is None:
            raise InvalidAction("Ambervale's open undertaking was already closed. Reset to run again.")
        level = c.val("SELECT max(level) FROM escalations WHERE entity_type = 'undertaking' AND entity_id = %s "
                      "AND status = 'open'", (u["id"],))
        f = documents.store(c, now, inst, entity_type="undertaking", entity_id=u["id"], slot="evidence",
                            filename="lab-equipment-invoices.pdf", content_type="application/pdf",
                            data=documents.tiny_pdf("Evidence of compliance", ["SYNTHETIC DATA", "Purchase invoices"]),
                            institution_id=u["institution_id"], application_id=u["application_id"])
        compliance.submit_evidence(c, now, inst, u["id"], f["id"], "Purchase invoices and installation report.")
        compliance.review_evidence(c, now, officer, u["id"], True, "Invoices match the equipment listed by the EVC.")
        run_alert_tick(c, now)
        open_left = c.val("SELECT count(*) FROM escalations WHERE entity_type = 'undertaking' AND entity_id = %s "
                          "AND status = 'open'", (u["id"],))
        caption = (f"Ambervale uploaded evidence (SHA-256 {f['sha256'][:12]}...). {officer['name']} verified it and "
                   f"the undertaking is closed. It had reached L{level or 0}; open escalations left on it: {open_left}.")
        return {"step": 7, "caption": caption, "link": "/compliance"}

    if step == 8:
        chain = verify_chain(c)
        k = {x["id"]: x for x in kpi.compute(c, clock.now(c))["kpis"]}
        caption = (f"Audit chain: {'VALID' if chain['valid'] else 'BROKEN'} across {chain['checked']} entries. "
                   f"Routing accuracy {k[1]['value']}%, alert timeliness {k[2]['value']}%, missed deadlines "
                   f"{k[3]['value']}, escalation coverage {k[6]['value']}%, audit completeness {k[7]['value']}%.")
        return {"step": 8, "caption": caption, "link": "/performance"}

    raise InvalidAction("Unknown step.")
