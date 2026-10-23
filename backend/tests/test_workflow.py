from datetime import timedelta

import pytest
from helpers import assignee, drive_to_end, stage, submit, user

from app import clock, rules, workflow
from app.clock import ist_date
from app.common import Invalid, InvalidAction, NotAllowed

ROUTE_BY_TYPE = {
    "EOA": ["intake", "scrutiny", "decision"],
    "INTAKE": ["intake", "scrutiny", "evc", "decision"],
    "LOCATION": ["intake", "evc", "sac", "decision"],
    "RESTORE": ["intake", "evc", "decision"],
    "NEW": ["intake", "scrutiny", "evc", "sac", "decision"],
}


@pytest.mark.parametrize("app_type", list(ROUTE_BY_TYPE))
def test_each_route_visits_its_stages_in_order(conn, app_type):
    app_id = submit(conn, "BRI", app_type)
    visited = drive_to_end(conn, app_id)
    assert visited == ROUTE_BY_TYPE[app_type]
    app = workflow.get_application(conn, app_id)
    assert app["status"] == "decided" and app["decision"] == "approved"
    assert app["route_snapshot"] == ROUTE_BY_TYPE[app_type]


def test_route_change_is_configuration_not_code(conn):
    bureau = user(conn, "bureau-head")
    rules.update_route(conn, clock.now(conn), bureau, "ONLY_SCRUTINY", ["intake", "scrutiny", "evc", "decision"])
    app_id = submit(conn, "BRI", "EOA")
    assert drive_to_end(conn, app_id) == ["intake", "scrutiny", "evc", "decision"]
    assert conn.val("SELECT count(*) FROM audit_log WHERE action = 'rule.changed' AND entity_id = 'route:ONLY_SCRUTINY'") == 1


def test_illegal_transitions_are_rejected(conn):
    app_id = submit(conn, "BRI", "INTAKE")
    officer = assignee(conn, app_id)
    director = user(conn, "rd-NR")
    # decision is not possible at the completeness check
    with pytest.raises(InvalidAction):
        workflow.record_decision(conn, clock.now(conn), director, app_id, "approved", "Trying to decide too early.")
    # an institution cannot complete scrutiny
    with pytest.raises(NotAllowed):
        workflow.complete_review(conn, clock.now(conn), user(conn, "inst-BRI"), app_id)
    workflow.complete_review(conn, clock.now(conn), officer, app_id)
    workflow.complete_review(conn, clock.now(conn), assignee(conn, app_id), app_id)
    assert stage(conn, app_id)["stage_code"] == "evc"
    # scrutiny actions do not apply at EVC
    with pytest.raises(InvalidAction):
        workflow.complete_review(conn, clock.now(conn), officer, app_id)
    with pytest.raises(InvalidAction):
        workflow.raise_deficiency(conn, clock.now(conn), officer, app_id, "Raising a deficiency at the EVC stage.")


def test_only_competent_authority_records_decision(conn):
    app_id = submit(conn, "BRI", "EOA")
    workflow.complete_review(conn, clock.now(conn), assignee(conn, app_id), app_id)
    workflow.complete_review(conn, clock.now(conn), assignee(conn, app_id), app_id)
    assert stage(conn, app_id)["stage_code"] == "decision"
    with pytest.raises(NotAllowed):
        workflow.record_decision(conn, clock.now(conn), user(conn, "off-NR-1"), app_id, "approved", "Officer decides.")
    with pytest.raises(NotAllowed):
        workflow.record_decision(conn, clock.now(conn), user(conn, "evc-1"), app_id, "approved", "Committee decides.")
    with pytest.raises(Invalid):
        workflow.record_decision(conn, clock.now(conn), user(conn, "rd-NR"), app_id, "approved", "")
    director = user(conn, "rd-NR")
    due = (clock.today(conn) + timedelta(days=90)).isoformat()
    ids = workflow.record_decision(conn, clock.now(conn), director, app_id, "approved_with_undertakings",
                                   "Approved subject to the undertaking below.",
                                   [{"condition": "Appoint two more faculty members.", "due_date": due}])
    assert len(ids) == 1
    entry = conn.one("SELECT * FROM audit_log WHERE action = 'decision.recorded' AND application_id = %s", (app_id,))
    assert entry["actor_id"] == director["id"] and entry["details"]["human_decision"] is True


def test_return_requires_a_reason(conn):
    app_id = submit(conn, "BRI", "EOA")
    officer = assignee(conn, app_id)
    for reason in ("", "   ", "too short"):
        with pytest.raises(Invalid):
            workflow.raise_deficiency(conn, clock.now(conn), officer, app_id, reason)


def test_sla_clock_pauses_while_deficiency_is_open(conn):
    app_id = submit(conn, "BRI", "EOA")
    workflow.complete_review(conn, clock.now(conn), assignee(conn, app_id), app_id)
    st = stage(conn, app_id)
    due_before = st["due_at"]
    officer = assignee(conn, app_id)
    def_id = workflow.raise_deficiency(conn, clock.now(conn), officer, app_id,
                                       "Upload the registered lease deed for the campus land.")
    st = stage(conn, app_id)
    assert st["substatus"] == "awaiting_institution" and st["paused_at"] is not None
    # an officer cannot complete scrutiny while waiting for the institution
    with pytest.raises(InvalidAction):
        workflow.complete_review(conn, clock.now(conn), officer, app_id)
    clock.advance(conn, 6, None)
    workflow.respond_deficiency(conn, clock.now(conn), user(conn, "inst-BRI"), def_id,
                                "Registered lease deed uploaded as requested.")
    st = stage(conn, app_id)
    assert st["substatus"] == "re_review" and st["paused_at"] is None
    assert st["paused_seconds"] == 6 * 86400
    assert ist_date(st["due_at"]) == ist_date(due_before) + timedelta(days=6)
    workflow.complete_review(conn, clock.now(conn), officer, app_id)
    assert stage(conn, app_id)["stage_code"] == "decision"


def test_other_institution_cannot_reply(conn):
    app_id = submit(conn, "BRI", "EOA")
    def_id = workflow.raise_deficiency(conn, clock.now(conn), assignee(conn, app_id), app_id,
                                       "Upload the building completion certificate.")
    with pytest.raises(NotAllowed):
        workflow.respond_deficiency(conn, clock.now(conn), user(conn, "inst-CED"), def_id, "Not my application at all.")


def test_revert_sends_case_back_to_scrutiny(conn):
    app_id = submit(conn, "BRI", "INTAKE")
    workflow.complete_review(conn, clock.now(conn), assignee(conn, app_id), app_id)
    workflow.complete_review(conn, clock.now(conn), assignee(conn, app_id), app_id)
    assert stage(conn, app_id)["stage_code"] == "evc"
    workflow.revert(conn, clock.now(conn), user(conn, "rd-NR"), app_id, "scrutiny",
                    "Visit cannot proceed until the land documents are re-checked.")
    st = stage(conn, app_id)
    assert st["stage_code"] == "scrutiny" and st["attempt"] == 2
    assert conn.val("SELECT status FROM evc_visits WHERE application_id = %s", (app_id,)) == "cancelled"
