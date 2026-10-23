from datetime import timedelta

import pytest
from helpers import user

from app import clock, compliance, documents
from app.alerts import run_alert_tick
from app.common import Invalid, InvalidAction, NotAllowed
from app.compliance import document_state


def _ambervale_undertaking(c):
    return c.one("""SELECT u.* FROM undertakings u JOIN applications a ON a.id = u.application_id
                    WHERE a.demo_tag = 'demo_legacy' AND u.status = 'open'""")


def test_undertaking_lifecycle_with_resubmission(conn):
    u = _ambervale_undertaking(conn)
    inst, officer = user(conn, "inst-AMB"), user(conn, "off-NR-1")
    with pytest.raises(NotAllowed):
        compliance.submit_evidence(conn, clock.now(conn), user(conn, "inst-BRI"), u["id"], None, "Wrong institution.")
    f = documents.store(conn, clock.now(conn), inst, entity_type="undertaking", entity_id=u["id"], slot="evidence",
                        filename="proof.pdf", content_type="application/pdf", data=b"%PDF-1.4 test",
                        institution_id=inst["institution_id"], application_id=u["application_id"])
    compliance.submit_evidence(conn, clock.now(conn), inst, u["id"], f["id"], "Purchase invoices attached.")
    with pytest.raises(Invalid):
        compliance.review_evidence(conn, clock.now(conn), officer, u["id"], False, "")
    compliance.review_evidence(conn, clock.now(conn), officer, u["id"], False, "Invoices do not cover all items listed.")
    assert conn.val("SELECT status FROM undertakings WHERE id = %s", (u["id"],)) == "resubmission_requested"
    compliance.submit_evidence(conn, clock.now(conn), inst, u["id"], None, "Complete invoices now uploaded on portal.")
    compliance.review_evidence(conn, clock.now(conn), officer, u["id"], True, "Verified.")
    row = conn.one("SELECT status, closed_by FROM undertakings WHERE id = %s", (u["id"],))
    assert row["status"] == "verified" and row["closed_by"] == officer["id"]
    with pytest.raises(InvalidAction):
        compliance.submit_evidence(conn, clock.now(conn), inst, u["id"], None, "Trying again after closure.")
    actions = [r["action"] for r in conn.all(
        "SELECT action FROM audit_log WHERE entity_type = 'undertaking' AND entity_id = %s ORDER BY id", (str(u["id"]),))]
    assert actions[-4:] == ["undertaking.evidence_submitted", "undertaking.resubmission_requested",
                            "undertaking.evidence_submitted", "undertaking.verified"]


def test_document_states():
    today = clock.SEED_NOW.date()
    base = {"status": "valid"}
    assert document_state({**base, "expires_on": today + timedelta(days=200)}, today, 60) == "valid"
    assert document_state({**base, "expires_on": today + timedelta(days=20)}, today, 60) == "expiring_soon"
    assert document_state({**base, "expires_on": today - timedelta(days=1)}, today, 60) == "expired"
    assert document_state({"status": "renewal_submitted", "expires_on": today - timedelta(days=5)}, today, 60) \
        == "renewal_submitted"


def test_lease_expiry_alerts_then_renewal(conn):
    lease = conn.one("""SELECT t.* FROM tracked_documents t JOIN institutions i ON i.id = t.institution_id
                        WHERE i.code = 'AMB'""")
    assert (lease["expires_on"] - clock.today(conn)).days == 20
    clock.advance(conn, 30, None)
    kinds = [(r["kind"], r["offset_days"]) for r in conn.all(
        "SELECT kind, offset_days FROM alerts WHERE entity_type = 'tracked_document' OR (entity_type = 'document' "
        "AND entity_id = %s) ORDER BY id", (lease["id"],))]
    assert ("reminder", -7) in kinds and ("overdue", 1) in kinds
    assert document_state(conn.one("SELECT * FROM tracked_documents WHERE id = %s", (lease["id"],)),
                          clock.today(conn), 60) == "expired"
    inst = user(conn, "inst-AMB")
    f = documents.store(conn, clock.now(conn), inst, entity_type="tracked_document", entity_id=lease["id"],
                        slot="renewal", filename="lease.pdf", content_type="application/pdf", data=b"%PDF-1.4 lease",
                        institution_id=inst["institution_id"], application_id=None)
    new_exp = clock.today(conn) + timedelta(days=365 * 5)
    compliance.submit_renewal(conn, clock.now(conn), inst, lease["id"], f["id"], new_exp)
    compliance.review_renewal(conn, clock.now(conn), user(conn, "off-NR-1"), lease["id"], True, "Registered deed checked.")
    run_alert_tick(conn, clock.now(conn))
    row = conn.one("SELECT * FROM tracked_documents WHERE id = %s", (lease["id"],))
    assert row["expires_on"] == new_exp and document_state(row, clock.today(conn), 60) == "valid"
    assert conn.val("SELECT count(*) FROM escalations WHERE entity_type = 'document' AND entity_id = %s "
                    "AND status = 'open'", (lease["id"],)) == 0


def test_file_size_limit_and_types(conn):
    inst = user(conn, "inst-AMB")
    kwargs = dict(entity_type="application", entity_id=1, slot="x", institution_id=inst["institution_id"],
                  application_id=None)
    with pytest.raises(Invalid):
        documents.store(conn, clock.now(conn), inst, filename="big.pdf", content_type="application/pdf",
                        data=b"x" * (2 * 1024 * 1024 + 1), **kwargs)
    with pytest.raises(Invalid):
        documents.store(conn, clock.now(conn), inst, filename="run.exe", content_type="application/x-msdownload",
                        data=b"MZ", **kwargs)
    a = documents.store(conn, clock.now(conn), inst, filename="a.txt", content_type="text/plain", data=b"v1", **kwargs)
    b = documents.store(conn, clock.now(conn), inst, filename="a.txt", content_type="text/plain", data=b"v2", **kwargs)
    assert (a["version"], b["version"]) == (1, 2)
    assert a["sha256"] == "3bfc269594ef649228e9a74bab00f042efc91d5acc6fbee31a382e80d42388fe"
