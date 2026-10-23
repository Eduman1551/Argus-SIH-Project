"""Helpers that drive a case through its route like the people involved would."""

from __future__ import annotations

from datetime import timedelta

from app import clock, scheduling, workflow
from app.workflow import committee


def user(c, code: str) -> dict:
    return c.one("SELECT * FROM users WHERE code = %s", (code,))


def submit(c, inst_code: str, app_type: str) -> int:
    actor = user(c, f"inst-{inst_code}")
    return workflow.submit_application(c, clock.now(c), actor, app_type=app_type, programme="B.Tech Test (60 seats)",
                                       academic_year="2026-27")


def stage(c, app_id: int) -> dict:
    return c.one("""SELECT s.* FROM applications a JOIN application_stages s ON s.id = a.current_stage_id
                    WHERE a.id = %s""", (app_id,))


def assignee(c, app_id: int) -> dict:
    return c.one("SELECT * FROM users WHERE id = %s", (stage(c, app_id)["assigned_to"],))


def finish_evc(c, app_id: int) -> None:
    st = stage(c, app_id)
    v = c.one("SELECT * FROM evc_visits WHERE stage_id = %s", (st["id"],))
    officer = assignee(c, app_id)
    members = [user(c, f"evc-{k}")["id"] for k in (6, 7, 8)]
    scheduling.assign_members(c, clock.now(c), officer, v["id"], members, members[0])
    visit_day = clock.today(c) + timedelta(days=3)
    for m in members:
        scheduling.respond_availability(c, clock.now(c), c.one("SELECT * FROM users WHERE id = %s", (m,)), v["id"],
                                        True, [visit_day])
    scheduling.schedule_visit(c, clock.now(c), officer, v["id"], visit_day)
    clock.advance(c, 3, None)
    convenor = c.one("SELECT * FROM users WHERE id = %s", (members[0],))
    scheduling.mark_conducted(c, clock.now(c), convenor, v["id"])
    scheduling.submit_report(c, clock.now(c), convenor, v["id"], "All facilities verified during the visit.",
                             "satisfactory")
    scheduling.review_report(c, clock.now(c), officer, v["id"], "Report reviewed.")


def drive_to_end(c, app_id: int, outcome: str = "approved") -> list[str]:
    """Push a case through every stage of its route. Returns the stage codes visited, in order."""
    for _ in range(10):
        app = workflow.get_application(c, app_id)
        if app["status"] == "decided":
            break
        st = stage(c, app_id)
        code = st["stage_code"]
        if code in ("intake", "scrutiny"):
            workflow.complete_review(c, clock.now(c), assignee(c, app_id), app_id, "ok")
        elif code == "evc":
            finish_evc(c, app_id)
        elif code == "sac":
            review = c.one("SELECT id FROM committee_reviews WHERE stage_id = %s", (st["id"],))
            member = c.val("SELECT user_id FROM committee_members WHERE review_id = %s ORDER BY user_id LIMIT 1",
                           (review["id"],))
            committee.recommend(c, clock.now(c), c.one("SELECT * FROM users WHERE id = %s", (member,)), review["id"],
                                "recommend_approval", "Committee is satisfied with the records.")
        elif code == "decision":
            workflow.record_decision(c, clock.now(c), assignee(c, app_id), app_id, outcome,
                                     "Decision recorded on the basis of the records.")
    return [r["stage_code"] for r in c.all(
        "SELECT stage_code FROM application_stages WHERE application_id = %s AND status <> 'reverted' ORDER BY id",
        (app_id,))]
