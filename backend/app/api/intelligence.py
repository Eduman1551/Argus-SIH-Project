"""Workflow intelligence endpoints: delay-risk assessments, watchlist, bottlenecks, recommendations, the
approve / dismiss actions and the intelligence results. Scoped like the rest of the API: officials see cases
(regional officers their own Region by default), only a permitted official can approve or dismiss, and the
results on the performance page are open to every signed-in user."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app import clock, intelligence, rules
from app.api.routes import _region_scope, _rule_change, tx
from app.auth import ensure_application, require_role

router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ models
class Reason(BaseModel):
    code: str
    label: str
    points: int
    text: str


class Factor(BaseModel):
    code: str
    label: str
    value: float = Field(ge=0, le=1)
    weight: int
    points: float
    text: str


class Assessment(BaseModel):
    score: int = Field(ge=0, le=100)
    band: str
    projected_completion: date
    case_due: date
    projected_delay: int
    remaining_days: int
    allowed_days: int
    summary: str
    reasons: list[Reason]
    factors: list[Factor]
    bands: dict[str, int]
    expected: dict[str, int]


class Split(BaseModel):
    days: dict[str, float]
    percent: dict[str, int]
    total_days: int
    as_of: date


class HistoryPoint(BaseModel):
    assessed_on: date
    score: int
    band: str
    projected_delay: int


class Intervention(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: int
    status: str
    action: str
    rule_code: str
    rule_label: str
    action_text: str
    reason: str
    effect: str
    est_days_saved: int
    rule_version: int
    can_act: bool
    authorized_text: str


class CaseRisk(BaseModel):
    assessment: Assessment | None
    split: Split
    history: list[HistoryPoint]
    recommendation: Intervention | None
    interventions: list[Intervention]


class Bottleneck(BaseModel):
    kind: str
    label: str
    cases: int
    high: int
    late: int
    delay_days: int
    share_pct: int
    cause: str
    text: str
    app_ids: list[int]


class Watch(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: int
    application_id: int
    ref_no: str
    institution: str
    score: int
    band: str
    rule_label: str
    reason: str


class Overview(BaseModel):
    counts: dict[str, int]
    needs_attention: list[Watch]
    open_recommendations: int
    bottlenecks: list[Bottleneck]
    cases: dict[int, dict]


class ApproveIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class DismissIn(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


class WeightIn(BaseModel):
    weight: int


class InterventionRuleIn(BaseModel):
    active: bool
    threshold: int
    est_days_saved: int


# ------------------------------------------------------------------ reads
def _scope(user: dict, region_id: int | None, all_regions: bool) -> int | None:
    return None if all_regions else (region_id or _region_scope(user))


@router.get("/intelligence/overview", response_model=Overview)
def overview(request: Request, region_id: int | None = None, all_regions: bool = False):
    with tx(request) as (c, user):
        require_role(user, "official")
        return intelligence.overview(c, clock.now(c), _scope(user, region_id, all_regions))


@router.get("/intelligence/watchlist", response_model=list[Watch])
def watchlist(request: Request, region_id: int | None = None, all_regions: bool = False):
    return overview(request, region_id, all_regions)["needs_attention"]


@router.get("/intelligence/bottlenecks", response_model=list[Bottleneck])
def bottlenecks(request: Request, region_id: int | None = None, all_regions: bool = False):
    return overview(request, region_id, all_regions)["bottlenecks"]


@router.get("/intelligence/recommendations")
def recommendations(request: Request, region_id: int | None = None, all_regions: bool = False):
    with tx(request) as (c, user):
        require_role(user, "official")
        scope = _scope(user, region_id, all_regions)
        return c.all(
            """SELECT i.id, i.application_id, a.ref_no, i.status, i.action, i.reason, i.effect, i.created_at,
                      i.score_before, i.band_before, r.code AS rule_code, r.label AS rule_label
               FROM interventions i JOIN intervention_rules r ON r.id = i.rule_id
               JOIN applications a ON a.id = i.application_id
               WHERE i.status = 'open' AND (%(r)s::int IS NULL OR a.region_id = %(r)s)
               ORDER BY i.score_before DESC, i.id""", {"r": scope})


@router.get("/intelligence/metrics")
def metrics(request: Request):
    with tx(request) as (c, _user):
        return intelligence.metrics(c, clock.now(c))


@router.get("/applications/{app_id}/risk", response_model=CaseRisk)
def case_risk(app_id: int, request: Request):
    with tx(request) as (c, user):
        require_role(user, "official")
        ensure_application(c, user, app_id)
        return intelligence.case_risk(c, clock.now(c), app_id, user)


@router.get("/applications/{app_id}/assessments", response_model=list[HistoryPoint])
def case_assessments(app_id: int, request: Request):
    with tx(request) as (c, user):
        require_role(user, "official")
        ensure_application(c, user, app_id)
        return c.all("""SELECT assessed_on, score, band, projected_delay FROM risk_assessments
                        WHERE application_id = %s ORDER BY assessed_on""", (app_id,))


@router.get("/applications/{app_id}/summary-wording")
def summary_wording(app_id: int, request: Request):
    """The risk summary reworded by the optional AI helper; the template sentence when it is not available."""
    from app import llm

    with tx(request) as (c, user):
        require_role(user, "official")
        ensure_application(c, user, app_id)
        pairs = intelligence.assess(c, clock.now(c), [app_id])
        if not pairs:
            return {"text": None, "source": "template"}
        text, source = llm.reword(pairs[0][1].summary)
        return {"text": text, "source": source}


# ------------------------------------------------------------------ authorised actions
@router.post("/interventions/{iid}/approve")
def approve(iid: int, body: ApproveIn, request: Request):
    with tx(request) as (c, user):
        result = intelligence.approve(c, clock.now(c), user, iid, body.note)
        return {"ok": True, **result}


@router.post("/interventions/{iid}/dismiss")
def dismiss(iid: int, body: DismissIn, request: Request):
    with tx(request) as (c, user):
        intelligence.dismiss(c, clock.now(c), user, iid, body.reason)
        return {"ok": True}


# ------------------------------------------------------------------ configuration (Bureau officers)
@router.put("/rules/risk-factors/{code}")
def put_risk_weight(code: str, body: WeightIn, request: Request):
    return _rule_change(request, rules.update_risk_weight, code, body.weight)


@router.put("/rules/interventions/{code}")
def put_intervention_rule(code: str, body: InterventionRuleIn, request: Request):
    return _rule_change(request, rules.update_intervention_rule, code, body.active, body.threshold, body.est_days_saved)
