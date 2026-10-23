"""Routing self-test: push one test application per route type through every stage inside a
savepoint, check the visited stages against the configured route, then roll everything back.
Nothing is kept. The scripted "people" here are a test harness, not automation of real decisions."""

from __future__ import annotations

from datetime import timedelta

from app import clock, scheduling, workflow
from app.rules import route_stage_codes
from app.workflow import committee
from db import Conn


def _user(c: Conn, uid: int) -> dict:
    return c.one("SELECT * FROM users WHERE id = %s", (uid,))


def _drive(c: Conn, app_id: int) -> list[str]:
    for _ in range(12):
        app = workflow.get_application(c, app_id)
        if app["status"] == "decided":
            break
        st = c.one("SELECT * FROM application_stages WHERE id = %s", (app["current_stage_id"],))
        owner = _user(c, st["assigned_to"]) if st["assigned_to"] else None
        now = clock.now(c)
        if st["stage_code"] in ("intake", "scrutiny"):
            workflow.complete_review(c, now, owner, app_id, "self-test")
        elif st["stage_code"] == "evc":
            v = c.one("SELECT id FROM evc_visits WHERE stage_id = %s", (st["id"],))
            ids = [r["id"] for r in c.all("SELECT id FROM users WHERE committee_kind = 'EVC' ORDER BY id LIMIT 2")]
            scheduling.assign_members(c, now, owner, v["id"], ids, ids[0])
            day = clock.today(c) + timedelta(days=1)
            for m in ids:
                scheduling.respond_availability(c, now, _user(c, m), v["id"], True, [day])
            scheduling.schedule_visit(c, now, owner, v["id"], day)
            clock.set_now(c, now + timedelta(days=1))
            scheduling.mark_conducted(c, clock.now(c), _user(c, ids[0]), v["id"])
            scheduling.submit_report(c, clock.now(c), _user(c, ids[0]), v["id"],
                                     "Self-test visit report with enough words.", "satisfactory")
            scheduling.review_report(c, clock.now(c), owner, v["id"], "self-test")
        elif st["stage_code"] == "sac":
            r = c.one("SELECT id FROM committee_reviews WHERE stage_id = %s", (st["id"],))
            m = c.val("SELECT user_id FROM committee_members WHERE review_id = %s ORDER BY user_id LIMIT 1", (r["id"],))
            committee.recommend(c, now, _user(c, m), r["id"], "recommend_approval", "Self-test recommendation.")
        elif st["stage_code"] == "decision":
            workflow.record_decision(c, now, owner, app_id, "approved", "Self-test decision, rolled back.")
    return [r["stage_code"] for r in c.all(
        "SELECT stage_code FROM application_stages WHERE application_id = %s ORDER BY id", (app_id,))]


def run_routing_selftest(c: Conn) -> dict:
    c.run("SAVEPOINT routing_selftest")
    results = []
    try:
        inst = c.one("SELECT * FROM users WHERE role = 'institution' ORDER BY id DESC LIMIT 1")
        for t in c.all("SELECT code, name, route_code FROM application_types ORDER BY name"):
            expected = route_stage_codes(c, t["route_code"])
            app_id = workflow.submit_application(c, clock.now(c), inst, app_type=t["code"],
                                                 programme="Self-test programme", academic_year="2026-27")
            visited = _drive(c, app_id)
            results.append({"type": t["name"], "route": t["route_code"], "expected": expected, "visited": visited,
                            "correct": visited == expected})
    finally:
        c.run("ROLLBACK TO SAVEPOINT routing_selftest")
    ok = sum(r["correct"] for r in results)
    return {"results": results, "correct": ok, "total": len(results),
            "value": round(100.0 * ok / len(results), 1) if results else None,
            "note": "Ran inside a savepoint and rolled back. No data was kept."}
