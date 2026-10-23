from datetime import timedelta

from helpers import user

from app import clock, compliance, rules, workflow
from app.alerts import run_alert_tick
from app.common import end_of_day


def _decided_app(c, inst_code="BRI"):
    row = c.one("""SELECT a.id FROM applications a JOIN institutions i ON i.id = a.institution_id
                   WHERE a.status = 'decided' ORDER BY a.id LIMIT 1""")
    app = workflow.get_application(c, row["id"])
    inst = c.one("SELECT id FROM institutions WHERE code = %s", (inst_code,))
    app["institution_id"] = inst["id"]
    return app


def _new_undertaking(c, due_in_days: int) -> int:
    app = _decided_app(c)
    due = end_of_day(clock.today(c) + timedelta(days=due_in_days))
    return compliance.create_undertaking(c, clock.now(c), user(c, "rd-NR"), app, "Test condition for alerts.", due)


def _alerts(c, uid):
    return c.all("""SELECT kind, offset_days, level, trigger_date, ist_date(fired_at) AS fired FROM alerts
                    WHERE entity_type = 'undertaking' AND entity_id = %s ORDER BY id""", (uid,))


def test_reminders_fire_on_exact_offsets_once_and_escalate_l1_to_l3(conn):
    start = clock.today(conn)
    uid = _new_undertaking(conn, 20)
    for _ in range(52):
        clock.advance(conn, 1, None)
        run_alert_tick(conn, clock.now(conn))  # a second tick on the same day must add nothing
    got = [(a["kind"], a["offset_days"], a["level"], (a["fired"] - start).days) for a in _alerts(conn, uid)]
    # -30 is skipped (its day was before the undertaking existed); others fire on their exact day
    assert got == [
        ("reminder", -15, None, 5), ("reminder", -7, None, 13), ("reminder", -1, None, 19),
        ("overdue", 1, None, 21),
        ("escalation", 7, 1, 27), ("escalation", 15, 2, 35), ("escalation", 30, 3, 50),
    ]
    assert all(a["fired"] == a["trigger_date"] for a in _alerts(conn, uid))
    esc = conn.all("SELECT level, target_user_id, status FROM escalations WHERE entity_type = 'undertaking' "
                   "AND entity_id = %s ORDER BY level", (uid,))
    assert [e["target_user_id"] for e in esc] == [user(conn, "rd-NR")["id"], user(conn, "bureau-officer")["id"],
                                                  user(conn, "bureau-head")["id"]]
    assert {e["status"] for e in esc} == {"open"}
    # each alert produced notifications and simulated email/SMS rows
    n = conn.val("SELECT count(*) FROM notifications WHERE alert_id IN (SELECT id FROM alerts WHERE entity_type = "
                 "'undertaking' AND entity_id = %s)", (uid,))
    o = conn.val("SELECT count(*) FROM outbox WHERE alert_id IN (SELECT id FROM alerts WHERE entity_type = "
                 "'undertaking' AND entity_id = %s)", (uid,))
    assert n >= 7 and o == 2 * n


def test_tick_is_idempotent(conn):
    clock.advance(conn, 3, None)
    before = conn.one("SELECT (SELECT count(*) FROM alerts) a, (SELECT count(*) FROM notifications) n, "
                      "(SELECT count(*) FROM escalations) e")
    for _ in range(3):
        result = run_alert_tick(conn, clock.now(conn))
        assert result["alerts"] == 0 and result["notifications"] == 0
    after = conn.one("SELECT (SELECT count(*) FROM alerts) a, (SELECT count(*) FROM notifications) n, "
                     "(SELECT count(*) FROM escalations) e")
    assert before == after
    dupes = conn.val("SELECT count(*) FROM (SELECT alert_key FROM alerts GROUP BY 1 HAVING count(*) > 1) x")
    assert dupes == 0


def test_changing_reminder_rule_changes_behaviour(conn):
    rules.update_reminder_offsets(conn, clock.now(conn), user(conn, "bureau-head"), "undertaking", [-3], 2)
    start = clock.today(conn)
    uid = _new_undertaking(conn, 10)
    for _ in range(13):
        clock.advance(conn, 1, None)
    got = [(a["kind"], a["offset_days"], (a["fired"] - start).days) for a in _alerts(conn, uid)]
    assert got == [("reminder", -3, 7), ("overdue", 2, 12)]
    assert conn.val("SELECT count(*) FROM audit_log WHERE action = 'rule.changed' AND entity_id = 'reminders:undertaking'") == 1


def test_escalation_resolves_when_item_is_closed(conn):
    uid = _new_undertaking(conn, 2)
    clock.advance(conn, 12, None)
    assert conn.val("SELECT count(*) FROM escalations WHERE entity_type = 'undertaking' AND entity_id = %s "
                    "AND status = 'open'", (uid,)) == 1
    inst = user(conn, "inst-BRI")
    compliance.submit_evidence(conn, clock.now(conn), inst, uid, None, "Appointment letters sent by post.")
    compliance.review_evidence(conn, clock.now(conn), user(conn, "off-NR-1"), uid, True, "Verified.")
    run_alert_tick(conn, clock.now(conn))
    assert conn.val("SELECT count(*) FROM escalations WHERE entity_type = 'undertaking' AND entity_id = %s "
                    "AND status = 'open'", (uid,)) == 0
    clock.advance(conn, 20, None)
    assert conn.val("SELECT count(*) FROM alerts WHERE entity_type = 'undertaking' AND entity_id = %s "
                    "AND kind = 'escalation' AND level > 1", (uid,)) == 0


def test_paused_stage_gets_no_overdue_alert(conn):
    from helpers import assignee, submit

    app_id = submit(conn, "BRI", "EOA")
    workflow.raise_deficiency(conn, clock.now(conn), assignee(conn, app_id), app_id,
                              "Upload the fire safety certificate for the hostel block.")
    clock.advance(conn, 14, None)
    stage_id = conn.val("SELECT current_stage_id FROM applications WHERE id = %s", (app_id,))
    assert conn.val("SELECT count(*) FROM alerts WHERE entity_type = 'stage' AND entity_id = %s", (stage_id,)) == 0
    # the institution's reply is tracked instead: reminders -7 and -2 have fired
    kinds = [r["offset_days"] for r in conn.all(
        "SELECT offset_days FROM alerts WHERE entity_type = 'deficiency' AND application_id = %s ORDER BY id", (app_id,))]
    assert kinds == [-7, -2]
