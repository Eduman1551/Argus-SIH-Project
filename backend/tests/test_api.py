"""API tests: scoped permissions, humans-decide guarantees, report/dashboard agreement, KPIs, demo."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def api(fresh_db):
    from app.main import app

    with TestClient(app) as client:
        users = {u["code"]: u["id"] for u in client.get("/api/users/demo").json()["users"]}

        def login(code: str):
            client.cookies.clear()
            assert client.post("/api/session", json={"user_id": users[code]}).status_code == 200
            return client

        client.login = login
        client.users = users
        yield client


def _case_id(api, tag):
    from db import transaction

    with transaction() as c:
        return c.val("SELECT id FROM applications WHERE demo_tag = %s", (tag,))


def test_requires_a_demo_session(api):
    api.cookies.clear()
    assert api.get("/api/dashboard").status_code == 401
    api.cookies.set("argus_session", "1.forged")
    assert api.get("/api/dashboard").status_code == 401


def test_institution_sees_only_its_own_cases_and_files(api):
    own, other = _case_id(api, "demo_scrutiny"), _case_id(api, "demo_l2")
    api.login("inst-AMB")
    assert api.get(f"/api/applications/{own}").status_code == 200
    assert api.get(f"/api/applications/{other}").status_code == 403
    listed = {r["id"] for r in api.get("/api/applications").json()["rows"]}
    assert own in listed and other not in listed
    from db import transaction

    with transaction() as c:
        other_file = c.val("SELECT id FROM files WHERE application_id = %s ORDER BY id LIMIT 1", (other,))
        own_file = c.val("SELECT id FROM files WHERE application_id = %s ORDER BY id LIMIT 1", (own,))
    assert api.get(f"/api/files/{other_file}").status_code == 403
    r = api.get(f"/api/files/{own_file}")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    # cannot upload evidence against another institution's undertaking
    with transaction() as c:
        foreign_u = c.val("""SELECT u.id FROM undertakings u JOIN institutions i ON i.id = u.institution_id
                             WHERE i.code <> 'AMB' LIMIT 1""")
    r = api.post("/api/files", data={"entity_type": "undertaking", "entity_id": str(foreign_u), "slot": "evidence"},
                 files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")})
    assert r.status_code == 403


def test_committee_sees_only_assigned_cases(api):
    assigned, unassigned = _case_id(api, "demo_visit_availability"), _case_id(api, "demo_l2")
    api.login("evc-1")
    assert api.get(f"/api/applications/{assigned}").status_code == 200
    assert api.get(f"/api/applications/{unassigned}").status_code == 403
    assert api.get("/api/applications").status_code == 403
    assert api.get("/api/evc/board").status_code == 403
    mine = api.get("/api/dashboard").json()
    assert {v["application_id"] for v in mine["visits"]} >= {assigned}
    assert unassigned not in {v["application_id"] for v in mine["visits"]}


def test_only_bureau_officers_edit_rules(api):
    api.login("off-NR-1")
    assert api.get("/api/rules").status_code == 200
    assert api.put("/api/rules/sla/scrutiny", json={"days": 30}).status_code == 403
    api.login("rd-NR")
    assert api.put("/api/rules/sla/scrutiny", json={"days": 30}).status_code == 403
    api.login("inst-AMB")
    assert api.get("/api/rules").status_code == 403
    api.login("bureau-head")
    r = api.put("/api/rules/sla/scrutiny", json={"days": 30})
    assert r.status_code == 200
    assert next(s for s in r.json()["sla"] if s["code"] == "scrutiny")["days"] == 30
    entry = api.get("/api/audit", params={"action": "rule.changed"}).json()["rows"][0]
    assert entry["details"]["before"] == 21 and entry["details"]["after"] == 30


def test_no_endpoint_decides_automatically(api):
    from app.main import app

    paths = [getattr(r, "path", "") for r in app.router.routes]
    paths += [r.path for r in app.router.routes[-1].original_router.routes] if hasattr(app.router.routes[-1], "original_router") else []
    for word in ("approve", "reject", "grant", "deny", "auto-decide"):
        assert not any(word in p for p in paths), word
    from db import transaction

    with transaction() as c:
        before = c.all("SELECT id, status, decision FROM applications ORDER BY id")
    api.login("off-NR-1")
    for _ in range(2):
        assert api.post("/api/clock/advance", json={"days": 30}).status_code == 200
    with transaction() as c:
        after = c.all("SELECT id, status, decision FROM applications ORDER BY id")
        auto = c.val("SELECT count(*) FROM audit_log WHERE action = 'decision.recorded' AND actor_id IS NULL")
    assert before == after and auto == 0
    # an officer below the competent authority cannot record a decision
    case = _case_id(api, "demo_decision")
    r = api.post(f"/api/applications/{case}/decision", json={"outcome": "approved", "reason": "Officer tries to decide."})
    assert r.status_code == 403


def test_report_totals_match_dashboard(api):
    api.login("bureau-head")
    dash = api.get("/api/dashboard", params={"all_regions": True}).json()
    pend = api.get("/api/reports/pendency").json()
    assert pend["totals"] == dash["totals"]
    overdue = api.get("/api/reports/overdue").json()
    assert overdue["totals"]["applications"] == dash["totals"]["overdue"]
    unds = api.get("/api/reports/undertakings").json()["totals"]
    docs = api.get("/api/reports/documents").json()["totals"]
    assert unds["overdue"] == dash["compliance"]["undertakings_overdue"]
    assert docs["expired"] == dash["compliance"]["documents_expired"]
    regions = api.get("/api/reports/regions").json()["totals"]
    assert regions["in_progress"] == dash["totals"]["cases"] and regions["overdue"] == dash["totals"]["overdue"]
    evc = api.get("/api/reports/evc").json()["totals"]
    assert evc["delayed"] == dash["compliance"]["evc_delayed"]
    csv = api.get("/api/reports/pendency", params={"format": "csv"})
    assert csv.status_code == 200 and "SYNTHETIC DATA" in csv.text


def test_kpis_are_live_and_healthy(api):
    api.login("bureau-head")
    k = {x["id"]: x for x in api.get("/api/kpi").json()["kpis"]}
    assert k[1]["value"] == 100.0 and k[1]["checked"] == 60
    assert k[2]["value"] == 100.0
    assert k[3]["value"] == 0 and k[3]["checked"] > 0
    assert k[4]["value"] == 100.0
    assert k[6]["value"] == 100.0
    assert k[7]["value"] == 100.0 and k[7]["chain_valid"] is True
    st = api.post("/api/kpi/routing-selftest").json()
    assert st["correct"] == st["total"] == 7


def test_live_poll_and_clock(api):
    api.login("inst-AMB")
    first = api.get("/api/live").json()
    assert first["clock"]["simulated"] is True and first["clock"]["today"] == "2026-05-15"
    r = api.post("/api/clock/advance", json={"days": 1}).json()
    assert r["to"] == "2026-05-16"
    assert api.post("/api/clock/advance", json={"days": 0}).status_code == 422
    assert api.get("/api/live").json()["version"] > first["version"]


def test_demo_scenario_runs_end_to_end(api):
    api.login("bureau-head")
    captions = []
    for step in range(1, 9):
        r = api.post(f"/api/demo/scenario/{step}")
        assert r.status_code == 200, (step, r.text)
        captions.append(r.json()["caption"])
    assert "VALID" in captions[-1]
    assert api.post("/api/demo/scenario/2").status_code == 409  # out of order after the run
    assert api.post("/api/demo/reset").status_code == 200
    assert api.get("/api/clock").json()["today"] == "2026-05-15"
