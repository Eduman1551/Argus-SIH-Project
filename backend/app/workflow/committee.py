"""SAC/SHC committee stage: queue, electronic case summary, recommendation (a human action)."""

from __future__ import annotations

from datetime import datetime

from app import notifications
from app.audit import record
from app.common import Invalid, NotAllowed, NotFound, ensure, fmt_date, region_director, require_text
from app.llm import case_summary
from app.workflow.facts import case_facts
from db import Conn

RECOMMENDATIONS = {
    "recommend_approval": "Recommend approval",
    "recommend_with_undertakings": "Recommend approval with undertakings",
    "recommend_not_approval": "Recommend not to approve",
}
MEMBERS_PER_REVIEW = 2


def _pick_members(conn: Conn) -> list[dict]:
    return conn.all(
        """SELECT u.*, (SELECT count(*) FROM committee_members m JOIN committee_reviews r ON r.id = m.review_id
                        WHERE m.user_id = u.id AND r.status = 'pending') AS load
           FROM users u WHERE u.role = 'committee' AND u.committee_kind = 'SAC'
           ORDER BY load, u.id LIMIT %s""",
        (MEMBERS_PER_REVIEW,),
    )


def open_review(conn: Conn, now: datetime, app: dict, stage: dict) -> int:
    text, source = case_summary(case_facts(conn, app["id"], now), use_llm=False)
    review_id = conn.val(
        """INSERT INTO committee_reviews (application_id, stage_id, status, summary, summary_source, summary_at)
           VALUES (%s,%s,'pending',%s,%s,%s) RETURNING id""",
        (app["id"], stage["id"], text, source, now),
    )
    members = _pick_members(conn)
    conn.many("INSERT INTO committee_members (review_id, user_id) VALUES (%s,%s)", [(review_id, m["id"]) for m in members])
    if members:
        conn.run("UPDATE application_stages SET assigned_to = %s WHERE id = %s", (members[0]["id"], stage["id"]))
    record(conn, at=now, actor=None, action="committee.review_opened", entity_type="committee_review",
           entity_id=review_id, application_id=app["id"],
           details={"members": [m["name"] for m in members], "summary_source": source})
    notifications.notify(conn, now=now, user_ids=[m["id"] for m in members], template_code="event.committee_assigned",
                         ctx={"ref": app["ref_no"], "institution": app["institution_name"],
                              "due_date": fmt_date(stage["due_at"])},
                         link=f"/cases/{app['id']}", kind="task")
    return review_id


def _review(conn: Conn, review_id: int) -> dict:
    r = conn.one("SELECT * FROM committee_reviews WHERE id = %s FOR UPDATE", (review_id,))
    if r is None:
        raise NotFound("Committee review not found.")
    return r


def is_member(conn: Conn, review_id: int, user_id: int) -> bool:
    return bool(conn.val("SELECT 1 FROM committee_members WHERE review_id = %s AND user_id = %s", (review_id, user_id)))


def reassign_members(conn: Conn, now: datetime, actor: dict, review_id: int, member_ids: list[int]) -> None:
    """An official changes which SAC/SHC members review the case."""
    ensure(actor["role"] == "official", "Only officials assign committee members.", NotAllowed)
    r = _review(conn, review_id)
    ensure(r["status"] == "pending", "The committee has already recorded its recommendation.")
    member_ids = list(dict.fromkeys(int(m) for m in member_ids))
    ensure(1 <= len(member_ids) <= 5, "Assign between 1 and 5 members.", Invalid)
    valid = conn.all("SELECT id, name FROM users WHERE id = ANY(%s) AND role = 'committee' AND committee_kind = 'SAC'",
                     (member_ids,))
    ensure(len(valid) == len(member_ids), "All members must be SAC/SHC committee members.", Invalid)
    before = [m["user_id"] for m in conn.all("SELECT user_id FROM committee_members WHERE review_id = %s", (review_id,))]
    conn.run("DELETE FROM committee_members WHERE review_id = %s", (review_id,))
    conn.many("INSERT INTO committee_members (review_id, user_id) VALUES (%s,%s)", [(review_id, m) for m in member_ids])
    conn.run("UPDATE application_stages SET assigned_to = %s WHERE id = %s", (member_ids[0], r["stage_id"]))
    record(conn, at=now, actor=actor, action="committee.members_assigned", entity_type="committee_review",
           entity_id=review_id, application_id=r["application_id"],
           details={"before": before, "after": member_ids, "members": sorted(v["name"] for v in valid)})
    app = conn.one("""SELECT a.ref_no, i.name AS institution, s.due_at FROM applications a
                      JOIN institutions i ON i.id = a.institution_id JOIN application_stages s ON s.id = %s
                      WHERE a.id = %s""", (r["stage_id"], r["application_id"]))
    new = [m for m in member_ids if m not in before]
    notifications.notify(conn, now=now, user_ids=new, template_code="event.committee_assigned",
                         ctx={"ref": app["ref_no"], "institution": app["institution"], "due_date": fmt_date(app["due_at"])},
                         link=f"/cases/{r['application_id']}", kind="task")


def regenerate_summary(conn: Conn, now: datetime, actor: dict, review_id: int, use_llm: bool) -> dict:
    r = _review(conn, review_id)
    ensure(actor["role"] == "official" or is_member(conn, review_id, actor["id"]),
           "Only the assigned committee members or officials can refresh the summary.", NotAllowed)
    ensure(r["status"] == "pending", "The committee has already recorded its recommendation.")
    text, source = case_summary(case_facts(conn, r["application_id"], now), use_llm=use_llm)
    conn.run("UPDATE committee_reviews SET summary = %s, summary_source = %s, summary_at = %s WHERE id = %s",
             (text, source, now, review_id))
    record(conn, at=now, actor=actor, action="committee.summary_generated", entity_type="committee_review",
           entity_id=review_id, application_id=r["application_id"], details={"source": source})
    return {"summary": text, "source": source}


def recommend(conn: Conn, now: datetime, actor: dict, review_id: int, recommendation: str, remarks: str) -> None:
    """A committee member records the committee's recommendation. The case then moves to the decision stage."""
    from app.workflow import current_stage, finish_stage, get_application

    r = _review(conn, review_id)
    ensure(actor["role"] == "committee" and is_member(conn, review_id, actor["id"]),
           "Only a committee member assigned to this case can record the recommendation.", NotAllowed)
    ensure(r["status"] == "pending", "A recommendation is already recorded.")
    ensure(recommendation in RECOMMENDATIONS, "Unknown recommendation.", Invalid)
    remarks = require_text(remarks, "Remarks")
    app = get_application(conn, r["application_id"], lock=True)
    stage = current_stage(conn, app)
    ensure(stage["id"] == r["stage_id"] and stage["status"] == "active", "This review is no longer the active stage.")
    conn.run("""UPDATE committee_reviews SET status = 'recommended', recommendation = %s, remarks = %s,
                       recommended_by = %s, recommended_at = %s WHERE id = %s""",
             (recommendation, remarks, actor["id"], now, review_id))
    record(conn, at=now, actor=actor, action="committee.recommended", entity_type="committee_review",
           entity_id=review_id, application_id=app["id"],
           details={"recommendation": recommendation, "remarks": remarks, "human_action": True})
    director = region_director(conn, app["region_id"])
    notifications.notify(conn, now=now, user_ids=[director["id"]] if director else [],
                         template_code="event.recommendation",
                         ctx={"ref": app["ref_no"], "outcome": RECOMMENDATIONS[recommendation]},
                         link=f"/applications/{app['id']}", kind="update")
    finish_stage(conn, now, actor, app, stage, remarks)
