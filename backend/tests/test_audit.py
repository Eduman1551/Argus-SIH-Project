import psycopg
import pytest
from helpers import assignee, submit

from app import clock, workflow
from app.audit import verify_chain
from app.common import Invalid


def test_chain_is_valid_after_seed_and_actions(conn):
    app_id = submit(conn, "BRI", "EOA")
    workflow.complete_review(conn, clock.now(conn), assignee(conn, app_id), app_id)
    result = verify_chain(conn)
    assert result["valid"] is True
    assert result["checked"] == conn.val("SELECT count(*) FROM audit_log")


def test_audit_log_is_append_only(conn):
    with pytest.raises(psycopg.errors.RaiseException):
        conn.run("UPDATE audit_log SET action = 'x' WHERE id = 5")


def test_tampering_is_detected(conn):
    conn.run("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update")
    conn.run("""UPDATE audit_log SET details = jsonb_set(details, '{reason}', '"edited later"')
                WHERE id = (SELECT min(id) FROM audit_log WHERE action = 'deficiency.raised')""")
    target = conn.val("SELECT min(id) FROM audit_log WHERE action = 'deficiency.raised'")
    result = verify_chain(conn)
    assert result["valid"] is False and result["broken_at"] == target


def test_deleted_entry_is_detected(conn):
    conn.run("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update")
    conn.run("DELETE FROM audit_log WHERE id = 100")
    result = verify_chain(conn)
    assert result["valid"] is False and result["broken_at"] == 101


def test_state_change_and_audit_share_a_transaction(conn):
    app_id = submit(conn, "BRI", "EOA")
    n = conn.val("SELECT count(*) FROM audit_log")
    with pytest.raises(Invalid):
        # fails validation: nothing is written, neither the change nor an audit entry
        workflow.raise_deficiency(conn, clock.now(conn), assignee(conn, app_id), app_id, "short")
    assert conn.val("SELECT count(*) FROM audit_log") == n
    assert conn.val("SELECT count(*) FROM deficiencies WHERE application_id = %s", (app_id,)) == 0
