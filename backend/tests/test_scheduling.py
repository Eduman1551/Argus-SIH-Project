from datetime import timedelta

import pytest
from helpers import assignee, submit, user

from app import clock, scheduling, workflow
from app.common import InvalidAction, NotAllowed


def test_delayed_visit_shows_as_delayed(conn):
    board = scheduling.board(conn, clock.now(conn))
    delayed = [v for v in board if v["category"] == "delayed"]
    tags = {conn.val("SELECT demo_tag FROM applications WHERE id = %s", (v["application_id"],)) for v in delayed}
    assert "demo_evc_delayed" in tags
    visit = next(v for v in board if conn.val("SELECT demo_tag FROM applications WHERE id = %s",
                                                  (v["application_id"],)) == "demo_visit_report")
    assert visit["category"] == "due" and visit["visit_date"] == clock.today(conn)


def test_visit_steps_are_guarded(conn):
    app_id = submit(conn, "BRI", "RESTORE")
    workflow.complete_review(conn, clock.now(conn), assignee(conn, app_id), app_id)
    v = conn.one("SELECT * FROM evc_visits WHERE application_id = %s", (app_id,))
    officer = assignee(conn, app_id)
    members = [user(conn, f"evc-{k}")["id"] for k in (2, 3)]
    with pytest.raises(NotAllowed):
        scheduling.assign_members(conn, clock.now(conn), user(conn, "evc-2"), v["id"], members, members[0])
    with pytest.raises(InvalidAction):
        scheduling.schedule_visit(conn, clock.now(conn), officer, v["id"], clock.today(conn) + timedelta(days=5))
    scheduling.assign_members(conn, clock.now(conn), officer, v["id"], members, members[0])
    # a member who is not on this visit cannot answer for it
    with pytest.raises(NotAllowed):
        scheduling.respond_availability(conn, clock.now(conn), user(conn, "evc-5"), v["id"], True,
                                        [clock.today(conn) + timedelta(days=5)])
    day = clock.today(conn) + timedelta(days=5)
    for m in members:
        scheduling.respond_availability(conn, clock.now(conn), conn.one("SELECT * FROM users WHERE id = %s", (m,)),
                                        v["id"], True, [day])
    assert scheduling.common_dates(conn, v["id"]) == [day]
    scheduling.schedule_visit(conn, clock.now(conn), officer, v["id"], day)
    with pytest.raises(InvalidAction):  # visit date not reached
        scheduling.mark_conducted(conn, clock.now(conn), user(conn, "evc-2"), v["id"])
    clock.advance(conn, 7, None)
    board = {b["id"]: b for b in scheduling.board(conn, clock.now(conn))}
    assert board[v["id"]]["category"] == "delayed"
    assert conn.val("SELECT count(*) FROM alerts WHERE entity_type = 'evc_step' AND entity_id = %s AND kind = 'overdue'",
                    (v["id"],)) == 1
