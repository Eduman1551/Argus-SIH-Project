"""Workflow intelligence: delay-risk factors, bands, projection, attribution, recommendation rules, role
enforcement, tick idempotency, outcome tracking, and one end-to-end run of the whole flow."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta

import pytest

from app.intelligence import scoring as S

TODAY = date(2026, 5, 15)
WEIGHTS = {"sla": 30, "stage_ageing": 20, "institution": 15, "reviewer_load": 15, "pipeline": 10, "returns": 5,
           "dependency": 5}
CFG = S.Config(weights=WEIGHTS, band_medium=35, band_high=65, capacity=6, committee_capacity=6,
               stage_sla={"intake": 7, "scrutiny": 21, "evc": 45, "sac": 14, "decision": 7},
               expected={"intake": 5, "scrutiny": 16, "evc": 36, "sac": 10, "decision": 6},
               reply_expected=5, reply_sla=15, snooze_days=14)
RULES = [
    {"id": 1, "code": "silent_institution", "action": "priority_reminder", "threshold": 7, "est_days_saved": 5, "active": True},
    {"id": 2, "code": "reviewer_overload", "action": "reassign", "threshold": 70, "est_days_saved": 6, "active": True},
    {"id": 3, "code": "evc_unscheduled", "action": "propose_visit_slot", "threshold": 2, "est_days_saved": 7, "active": True},
    {"id": 4, "code": "stage_ageing", "action": "escalate", "threshold": 150, "est_days_saved": 4, "active": True},
    {"id": 5, "code": "document_expiring", "action": "request_document", "threshold": 0, "est_days_saved": 3, "active": True},
]


def case(**kw) -> S.CaseInputs:
    base = dict(app_id=1, ref_no="ARG/2026/NR/0001", institution_id=1, institution="Testvale Institute", region_id=1,
                region="Northern", route=("intake", "scrutiny", "evc", "decision"), seq=2, stage_code="scrutiny",
                stage_name="Scrutiny", substatus="in_review", submitted=TODAY - timedelta(days=20), today=TODAY,
                institution_days=0, stage_days=10, stage_due=TODAY + timedelta(days=11), assigned_to=7,
                assignee="Officer Seven", assignee_load=3)
    base.update(kw)
    return S.CaseInputs(**base)


def facts(inp: S.CaseInputs) -> dict[str, float]:
    completion, due, _, remaining = S.project(inp, CFG)
    return S.factors(inp, CFG, completion, due, remaining)


# ------------------------------------------------------------------ factors
def test_time_limit_factor_uses_the_case_or_the_stage_whichever_is_further():
    on_time = facts(case(stage_days=10))
    assert on_time["sla"] == pytest.approx(10 / 21, abs=0.01)  # the stage is further along than the case
    overdue = facts(case(stage_days=30, stage_due=TODAY - timedelta(days=9)))
    assert overdue["sla"] == 1.0


def test_stage_ageing_is_days_over_one_and_a_half_times_expected():
    assert facts(case(stage_days=12))["stage_ageing"] == pytest.approx(12 / 24)
    assert facts(case(stage_days=40))["stage_ageing"] == 1.0


def test_waiting_on_institution_counts_share_and_an_open_reply():
    f = facts(case(institution_days=5, open_deficiency_days=15, substatus="awaiting_institution"))
    assert f["institution"] == pytest.approx(min(1, 5 / 20 + 0.5 * 15 / 15))
    assert facts(case())["institution"] == 0.0


def test_reviewer_load_uses_officer_or_committee_capacity():
    assert facts(case(assignee_load=3))["reviewer_load"] == pytest.approx(0.5)
    assert facts(case(assignee_load=9))["reviewer_load"] == 1.0
    committee = case(stage_code="sac", stage_name="SAC/SHC review", seq=3, route=("intake", "evc", "sac", "decision"),
                     committee_load=3)
    assert facts(committee)["reviewer_load"] == pytest.approx(0.5)
    assert facts(case(assigned_to=None, assignee=None))["reviewer_load"] == 0.0


def test_remaining_pipeline_and_repeat_returns():
    assert facts(case(stage_due=TODAY - timedelta(days=60)))["pipeline"] == 1.0
    assert facts(case(returns=1))["returns"] == pytest.approx(1 / 3)
    assert facts(case(returns=5))["returns"] == 1.0


def test_dependency_for_unscheduled_visit_or_expiring_document():
    evc = case(stage_code="evc", stage_name="Expert Visit (EVC)", seq=3, visit_status="date_pending")
    assert facts(evc)["dependency"] == 1.0
    assert facts(replace(evc, visit_status="scheduled"))["dependency"] == 0.0
    assert facts(case(doc_title="Land lease deed", doc_expires=TODAY + timedelta(days=5)))["dependency"] == 1.0
    assert facts(case(doc_title="Land lease deed", doc_expires=TODAY + timedelta(days=400)))["dependency"] == 0.0


def test_score_is_the_weighted_sum_and_every_factor_stays_in_range():
    f = {k: 1.0 for k in S.FACTOR_ORDER}
    assert S.score(f, WEIGHTS) == 100
    assert S.score({k: 0.0 for k in S.FACTOR_ORDER}, WEIGHTS) == 0
    half = {k: 0.5 for k in S.FACTOR_ORDER}
    assert S.score(half, WEIGHTS) == 50
    assert S.score(f, {**WEIGHTS, "sla": 0}) == 100  # normalised by the weights in use
    for v in facts(case(institution_days=50, open_deficiency_days=40, returns=9, assignee_load=99)).values():
        assert 0.0 <= v <= 1.0


def test_band_edges():
    assert S.band(34, CFG) == "low"
    assert S.band(35, CFG) == "medium"
    assert S.band(64, CFG) == "medium"
    assert S.band(65, CFG) == "high"


def test_projected_completion_and_delay():
    inp = case(stage_days=10)
    completion, due, delay, remaining = S.project(inp, CFG)
    assert remaining == (16 - 10) + 36 + 6
    assert completion == TODAY + timedelta(days=remaining)
    assert due == inp.stage_due + timedelta(days=45 + 7)
    assert delay == max(0, (completion - due).days)
    late = case(stage_days=30, stage_due=TODAY - timedelta(days=9))
    assert S.project(late, CFG)[2] == 10  # the stage ends at least a day from now, 9 days past its due date


def test_assessment_explains_its_top_reasons_in_points():
    a = S.assess(case(stage_days=30, stage_due=TODAY - timedelta(days=9), assignee_load=9), CFG)
    assert a.band == "high"
    assert [r["code"] for r in a.reasons][:2] == ["sla", "stage_ageing"]
    assert all(r["points"] > 0 and r["text"] for r in a.reasons)
    assert sum(a.points.values()) == pytest.approx(a.score, abs=0.6)
    assert "high risk" in a.summary


# ------------------------------------------------------------------ attribution
@pytest.mark.parametrize("days", [
    {"institution": 3.3, "official": 3.3, "committee": 3.3},
    {"official": 1.0},
    {"institution": 0.4, "official": 12.7, "committee": 0.1, "scheduling": 5.55, "system": 0.25},
])
def test_waiting_time_split_adds_up_to_100(days):
    assert sum(S.split_percent(days).values()) == 100


def test_waiting_time_split_is_empty_without_time():
    assert S.split_percent({}) == {}


# ------------------------------------------------------------------ rules and roles
def officers():
    return [{"id": 7, "name": "Officer Seven", "region_id": 1, "load": 8, "can_decide": False},
            {"id": 8, "name": "Officer Eight", "region_id": 1, "load": 1, "can_decide": False},
            {"id": 9, "name": "Elsewhere", "region_id": 2, "load": 0, "can_decide": False}]


def test_each_rule_triggers_on_its_condition():
    silent = case(open_deficiency_days=10, substatus="awaiting_institution", stage_days=30, institution_days=10,
                  stage_due=TODAY - timedelta(days=9))
    a = S.assess(silent, CFG)
    assert a.band == "high"
    assert "silent_institution" in [m["rule"]["code"] for m in S.match_rules(silent, a, RULES, CFG)]

    busy = case(assignee_load=8, stage_days=25, stage_due=TODAY - timedelta(days=4))
    m = S.match_rules(busy, S.assess(busy, CFG), RULES, CFG, officers())
    reassign = next(x for x in m if x["rule"]["code"] == "reassign" or x["rule"]["code"] == "reviewer_overload")
    assert reassign["params"]["target_id"] == 8  # least loaded in the same Region, not the one in Region 2

    evc = case(stage_code="evc", stage_name="Expert Visit (EVC)", seq=3, visit_status="assignment_pending",
               stage_days=60, stage_due=TODAY - timedelta(days=1), visit_id=3)
    codes = [x["rule"]["code"] for x in S.match_rules(evc, S.assess(evc, CFG), RULES, CFG)]
    assert codes[0] == "evc_unscheduled"  # highest estimated days saved wins
    assert "stage_ageing" in codes

    doc = case(doc_id=4, doc_title="Land lease deed", doc_expires=TODAY + timedelta(days=5), stage_days=25,
               stage_due=TODAY - timedelta(days=4))
    assert "document_expiring" in [x["rule"]["code"] for x in S.match_rules(doc, S.assess(doc, CFG), RULES, CFG)]


def test_low_risk_cases_get_no_recommendation_and_inactive_rules_are_skipped():
    calm = case(stage_days=1, doc_title="Lease", doc_id=1, doc_expires=TODAY + timedelta(days=3))
    a = S.assess(replace(calm, doc_expires=None), CFG)
    assert a.band == "low" and S.match_rules(calm, a, RULES, CFG) == []
    hot = case(stage_days=30, stage_due=TODAY - timedelta(days=9))
    off = [dict(r, active=False) for r in RULES]
    assert S.match_rules(hot, S.assess(hot, CFG), off, CFG) == []


def test_who_may_authorise():
    regional = {"role": "official", "official_kind": "regional", "region_id": 1}
    other = {"role": "official", "official_kind": "regional", "region_id": 2}
    bureau = {"role": "official", "official_kind": "bureau", "region_id": None}
    for outsider in ({"role": "institution"}, {"role": "committee"}):
        assert not S.can_authorize(outsider, "regional_or_bureau", 1)
    assert S.can_authorize(regional, "regional", 1)
    assert not S.can_authorize(other, "regional", 1)
    assert not S.can_authorize(bureau, "regional", 1)
    assert S.can_authorize(bureau, "regional_or_bureau", 1)
    assert S.can_authorize(bureau, "bureau", 1) and not S.can_authorize(regional, "bureau", 1)


def test_bottlenecks_rank_where_delay_concentrates():
    def row(i, stage, region, owner, delay, band):
        return {"app_id": i, "stage_name": stage, "region": region, "owner": owner, "institution": f"Inst {i}",
                "band": band, "projected_delay": delay, "points": {"reviewer_load": 10.0, "sla": 5.0}}
    rows = [row(1, "Scrutiny", "Northern", "A", 10, "high"), row(2, "Scrutiny", "Northern", "A", 6, "high"),
            row(3, "Decision", "Central", "B", 4, "medium"), row(4, "Scrutiny", "Southern", "C", 0, "low")]
    out = S.bottlenecks(rows)
    assert out[0]["label"] == "Scrutiny in Northern Region" and out[0]["share_pct"] == 80
    assert out[0]["cause"] == "reviewer load" and "2 cases at high risk" in out[0]["text"]
    assert len(out) <= 3 and all(g["delay_days"] > 0 for g in out)


# ------------------------------------------------------------------ with the database
def test_tick_is_idempotent(conn):
    from app import clock, intelligence

    now = clock.now(conn)
    first = intelligence.on_tick(conn, now)
    rows = conn.val("SELECT count(*) FROM risk_assessments")
    opened = conn.val("SELECT count(*) FROM interventions WHERE status = 'open'")
    again = intelligence.on_tick(conn, now)
    assert first["assessed"] == again["assessed"] > 0
    assert again["recommended"] == 0 and again["withdrawn"] == 0
    assert conn.val("SELECT count(*) FROM risk_assessments") == rows
    assert conn.val("SELECT count(*) FROM interventions WHERE status = 'open'") == opened
    assert conn.val("SELECT count(*) FROM interventions WHERE status = 'open' GROUP BY application_id "
                    "ORDER BY 1 DESC LIMIT 1") == 1


def test_outcome_is_measured_once_after_seven_days(conn):
    from app import clock, intelligence

    now = clock.now(conn)
    iv = conn.one("""SELECT i.id, i.application_id FROM interventions i JOIN applications a ON a.id = i.application_id
                     WHERE i.status = 'open' AND a.demo_tag = 'demo_scrutiny'""")
    officer = conn.one("SELECT * FROM users WHERE code = 'off-NR-1'")
    intelligence.approve(conn, now, officer, iv["id"])
    later = now + timedelta(days=7)
    current = {a.app_id: a for _, a in intelligence.assess(conn, later)}
    assert intelligence.measure_outcomes(conn, later, current) >= 1
    assert intelligence.measure_outcomes(conn, later, current) == 0
    conn.flush()
    row = conn.one("SELECT * FROM intervention_outcomes WHERE intervention_id = %s AND checkpoint = 'day7'", (iv["id"],))
    assert row is not None and row["score_after"] is not None


@pytest.fixture
def api(fresh_db):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        users = {u["code"]: u["id"] for u in client.get("/api/users/demo").json()["users"]}

        def login(code: str):
            client.cookies.clear()
            assert client.post("/api/auth/login", json={"user_id": users[code]}).status_code == 200
            return client

        client.login = login
        yield client


def test_full_flow_predict_explain_recommend_authorise_audit(api):
    """Assessment -> bottlenecks -> recommendation -> only a permitted official approves -> audit."""
    api.login("off-NR-1")
    ov = api.get("/api/intelligence/overview").json()
    assert sum(ov["counts"].values()) > 0 and len(ov["bottlenecks"]) <= 3 and len(ov["needs_attention"]) <= 5

    from db import transaction

    with transaction() as c:
        nr = c.val("SELECT id FROM applications WHERE demo_tag = 'demo_scrutiny'")
        cr = c.val("SELECT id FROM applications WHERE demo_tag = 'demo_l2'")
    risk = api.get(f"/api/applications/{nr}/risk").json()
    assert 0 <= risk["assessment"]["score"] <= 100
    assert sum(risk["split"]["percent"].values()) == 100
    rec = risk["recommendation"]
    assert rec and rec["can_act"]
    cr_rec = api.get(f"/api/applications/{cr}/risk").json()["recommendation"]
    assert cr_rec and not cr_rec["can_act"]

    # nobody else may act on it: another Region, a committee member, the institution
    assert api.post(f"/api/interventions/{cr_rec['id']}/accept", json={}).status_code == 403
    for code in ("evc-1", "inst-AMB"):
        api.login(code)
        assert api.post(f"/api/interventions/{rec['id']}/accept", json={}).status_code == 403
        assert api.get(f"/api/applications/{nr}/risk").status_code == 403

    api.login("off-NR-1")
    assert api.post(f"/api/interventions/{cr_rec['id']}/dismiss", json={"reason": "short"}).status_code == 422
    r = api.post(f"/api/interventions/{rec['id']}/accept", json={"note": "Lease renewal needed before the visit."})
    assert r.status_code == 200 and r.json()["done"]
    assert api.post(f"/api/interventions/{rec['id']}/accept", json={}).status_code == 409

    api.login("bureau-head")
    assert api.post(f"/api/interventions/{cr_rec['id']}/dismiss",
                    json={"reason": "The officer is already handling this case today."}).status_code == 200
    audit = api.get("/api/audit?action=intervention").json()["rows"]
    actions = {e["action"] for e in audit}
    assert {"intervention.approved", "intervention.dismissed"} <= actions
    approved = next(e for e in audit if e["action"] == "intervention.approved")
    assert approved["actor_id"] is not None and approved["details"]["rule"]
    assert api.post("/api/audit/verify").json()["valid"]

    m = api.get("/api/intelligence/metrics").json()
    assert m["backtest"]["cases"] > 0 and m["interventions"]["approved"] > 0


def test_no_endpoint_runs_an_intervention_by_itself(api):
    """Advancing the clock creates recommendations but never approves one."""
    api.login("off-NR-1")
    from db import transaction

    with transaction() as c:
        before = c.val("SELECT count(*) FROM interventions WHERE status = 'approved'")
    assert api.post("/api/clock/advance", json={"days": 2}).status_code == 200
    with transaction() as c:
        assert c.val("SELECT count(*) FROM interventions WHERE status = 'approved'") == before
