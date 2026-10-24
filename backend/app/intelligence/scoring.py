"""Delay-risk scoring: pure functions, no database access, so every number can be unit-tested.

Risk = 100 * sum(w_i * f_i) / sum(w_i), with every factor f_i in [0, 1] and the weights w_i taken from the
`risk_factors` configuration table. The score is a transparent weighted sum of named factors, not a trained
model: each factor's contribution is reported in points, so a reader can see exactly why a case scores
what it does. The functions here only predict, explain and match recommendation rules. Nothing here acts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from app.common import fmt_date

FACTOR_ORDER = ("sla", "stage_ageing", "institution", "reviewer_load", "pipeline", "returns", "dependency")
FACTOR_LABELS = {
    "sla": "Time limit used",
    "stage_ageing": "Stage ageing",
    "institution": "Waiting on the institution",
    "reviewer_load": "Reviewer load",
    "pipeline": "Remaining work",
    "returns": "Repeat returns",
    "dependency": "Dependencies",
}
OFFICIAL_EVC_STEPS = ("assignment_pending", "date_pending", "report_submitted")
UNSCHEDULED_EVC = ("assignment_pending", "availability_pending", "date_pending")


@dataclass(frozen=True)
class Config:
    weights: dict[str, int]
    band_medium: int
    band_high: int
    capacity: int
    committee_capacity: int
    stage_sla: dict[str, int]
    expected: dict[str, int]          # expected stage duration in working days (configured, adjusted by history)
    reply_expected: int               # expected days for an institution reply
    reply_sla: int
    snooze_days: int = 14


@dataclass(frozen=True)
class CaseInputs:
    app_id: int
    ref_no: str
    institution_id: int
    institution: str
    region_id: int
    region: str
    route: tuple[str, ...]
    seq: int                          # 1-based position of the current stage in the route
    stage_code: str
    stage_name: str
    substatus: str
    submitted: date
    today: date
    institution_days: int             # days waited on the institution so far (all stages, open pause included)
    stage_days: int                   # working days in the current stage (institution time excluded)
    stage_due: date                   # due date of the current stage (moved on by any open institution wait)
    assigned_to: int | None = None
    assignee: str | None = None
    assignee_load: int = 0
    committee_load: int = 0
    open_deficiency_days: int | None = None
    deficiency_due: date | None = None
    returns: int = 0
    visit_id: int | None = None
    visit_status: str | None = None
    doc_id: int | None = None
    doc_title: str | None = None
    doc_expires: date | None = None
    escalation_level: int | None = None


@dataclass
class Assessment:
    app_id: int
    score: int
    band: str
    factors: dict[str, float]
    points: dict[str, float]
    projected_completion: date
    case_due: date
    projected_delay: int
    remaining_days: int
    allowed_days: int
    stage_late: int = 0               # days the current stage is expected to finish after its own due date
    reasons: list[dict] = field(default_factory=list)
    summary: str = ""


# ------------------------------------------------------------------ projection
def case_due(inp: CaseInputs, cfg: Config) -> date:
    """The case's deadline as the time limits chain it: the current stage's due date (moved on while the
    institution is replying) plus the configured time limit of every later stage on the route."""
    return inp.stage_due + timedelta(days=sum(cfg.stage_sla.get(s, 0) for s in inp.route[inp.seq:]))


def allowed_days(inp: CaseInputs, cfg: Config) -> int:
    """Working days the case is allowed from submission to its due date (time waited on the institution excluded)."""
    return max(1, (case_due(inp, cfg) - inp.submitted).days - inp.institution_days)


def stage_rest(inp: CaseInputs, cfg: Config) -> int:
    """Expected days left in the current stage (at least one), including any reply still awaited."""
    rest = max(1, cfg.expected.get(inp.stage_code, 0) - inp.stage_days)
    if inp.open_deficiency_days is not None:
        rest += max(0, cfg.reply_expected - inp.open_deficiency_days)
    return rest


def remaining_days(inp: CaseInputs, cfg: Config) -> int:
    """Expected days of work left: the rest of the current stage and the expected duration of every later stage."""
    return stage_rest(inp, cfg) + sum(cfg.expected.get(s, 0) for s in inp.route[inp.seq:])


def project(inp: CaseInputs, cfg: Config) -> tuple[date, date, int, int]:
    """(projected completion, case due date, projected delay in days, remaining days).

    The projected delay is the larger of two gaps: the expected decision against the case's due date, and the
    expected end of the current stage against that stage's own due date (so a stage that is already late counts
    even when later stages still have slack)."""
    remaining = remaining_days(inp, cfg)
    completion = inp.today + timedelta(days=remaining)
    due = case_due(inp, cfg)
    stage_end = inp.today + timedelta(days=stage_rest(inp, cfg))
    delay = max(0, (completion - due).days, (stage_end - inp.stage_due).days)
    return completion, due, delay, remaining


# ------------------------------------------------------------------ factors
def _clip(x: float) -> float:
    return max(0.0, min(1.0, x))


def reviewer_load(inp: CaseInputs, cfg: Config) -> tuple[float, str]:
    """(factor, who): officials for review steps, committee members for visit and committee steps."""
    committee_step = inp.stage_code == "sac" or (inp.stage_code == "evc" and inp.visit_status not in OFFICIAL_EVC_STEPS)
    if committee_step:
        return (_clip(inp.committee_load / cfg.committee_capacity) if cfg.committee_capacity else 0.0), "committee"
    if inp.assigned_to is None:
        return 0.0, "official"
    return (_clip(inp.assignee_load / cfg.capacity) if cfg.capacity else 0.0), "official"


def dependency_issue(inp: CaseInputs, completion: date) -> str | None:
    if inp.stage_code == "evc" and inp.visit_status in UNSCHEDULED_EVC:
        return "evc"
    if inp.doc_expires is not None and inp.doc_expires <= completion:
        return "document"
    return None


def sla_parts(inp: CaseInputs, cfg: Config) -> tuple[float, float]:
    """(share of the case's allowed time used, share of the current stage's time limit used)."""
    age = max(1, (inp.today - inp.submitted).days)
    case_share = max(0, age - inp.institution_days) / max(1, allowed_days(inp, cfg))
    stage_share = inp.stage_days / max(1, cfg.stage_sla.get(inp.stage_code, 1))
    return case_share, stage_share


def factors(inp: CaseInputs, cfg: Config, completion: date, due: date, remaining: int) -> dict[str, float]:
    age = max(1, (inp.today - inp.submitted).days)
    expected = max(1, cfg.expected.get(inp.stage_code, 1))
    inst = inp.institution_days / age
    if inp.open_deficiency_days is not None:
        inst += 0.5 * _clip(inp.open_deficiency_days / max(1, cfg.reply_sla))
    days_left = (due - inp.today).days
    return {
        # time limit used: the case as a whole, or the current stage if that is further along (an overdue
        # stage counts in full even when later stages still have slack)
        "sla": _clip(max(sla_parts(inp, cfg))),
        "stage_ageing": _clip(inp.stage_days / (1.5 * expected)),
        "institution": _clip(inst),
        "reviewer_load": reviewer_load(inp, cfg)[0],
        "pipeline": 1.0 if days_left <= 0 else _clip(remaining / days_left),
        "returns": _clip(inp.returns / 3),
        "dependency": 1.0 if dependency_issue(inp, completion) else 0.0,
    }


def points(f: dict[str, float], weights: dict[str, int]) -> dict[str, float]:
    """Contribution of each factor to the score, in points out of 100."""
    total = sum(max(0, w) for w in weights.values()) or 1
    return {k: 100.0 * max(0, weights.get(k, 0)) * f.get(k, 0.0) / total for k in FACTOR_ORDER}


def score(f: dict[str, float], weights: dict[str, int]) -> int:
    return int(round(min(100.0, max(0.0, sum(points(f, weights).values())))))


def band(value: int, cfg: Config) -> str:
    if value >= cfg.band_high:
        return "high"
    if value >= cfg.band_medium:
        return "medium"
    return "low"


# ------------------------------------------------------------------ explanation
def reason_text(code: str, inp: CaseInputs, cfg: Config, completion: date, due: date, remaining: int) -> str:
    age = max(1, (inp.today - inp.submitted).days)
    if code == "sla":
        case_share, stage_share = sla_parts(inp, cfg)
        if stage_share > case_share:
            return (f"Used {inp.stage_days} of the {cfg.stage_sla.get(inp.stage_code, 0)} days allowed for "
                    f"{inp.stage_name}")
        return (f"Used {max(0, age - inp.institution_days)} of the {allowed_days(inp, cfg)} working days "
                f"allowed for the case")
    if code == "stage_ageing":
        return f"{inp.stage_days} days at {inp.stage_name} (expected about {cfg.expected.get(inp.stage_code, 0)})"
    if code == "institution":
        if inp.open_deficiency_days is not None:
            return f"Reply from the institution pending for {inp.open_deficiency_days} days"
        return f"Waited on the institution for {inp.institution_days} of {age} days"
    if code == "reviewer_load":
        _, who = reviewer_load(inp, cfg)
        if who == "committee":
            return (f"Committee members carry up to {inp.committee_load} open visits or reviews "
                    f"(capacity {cfg.committee_capacity})")
        return f"{inp.assignee or 'The officer'} has {inp.assignee_load} open cases (capacity {cfg.capacity})"
    if code == "pipeline":
        left = (due - inp.today).days
        if left <= 0:
            return "Already past the overall due date"
        return f"About {remaining} days of work left and {left} days to the due date"
    if code == "returns":
        return f"Returned {inp.returns} time{'s' if inp.returns != 1 else ''} so far"
    issue = dependency_issue(inp, completion)
    if issue == "evc":
        return "Expert visit not scheduled yet"
    if issue == "document":
        return f"{inp.doc_title} expires on {fmt_date(inp.doc_expires)}, before the expected decision"
    return "No open dependencies"


def summary(inp: CaseInputs, a: Assessment) -> str:
    """One plain sentence, written from a template (the AI helper may reword it, never change it)."""
    top = a.reasons[0]["text"].lower() if a.reasons else "no single cause"
    if a.band == "high":
        if a.stage_late and a.stage_late >= a.projected_delay:
            return (f"{inp.ref_no} is at high risk: {inp.stage_name} is expected to finish about {a.stage_late} days "
                    f"after its due date of {fmt_date(inp.stage_due)}, with the decision around "
                    f"{fmt_date(a.projected_completion)}. Main reason: {top}.")
        late = f", about {a.projected_delay} days late" if a.projected_delay else ""
        return (f"{inp.ref_no} is at high risk of missing its due date of {fmt_date(a.case_due)}: the expected "
                f"decision is around {fmt_date(a.projected_completion)}{late}. Main reason: {top}.")
    if a.band == "medium":
        return (f"{inp.ref_no} could slip: the expected decision is around {fmt_date(a.projected_completion)} "
                f"against a due date of {fmt_date(a.case_due)}. Watch: {top}.")
    return (f"{inp.ref_no} is on course: the expected decision is around {fmt_date(a.projected_completion)}, "
            f"due {fmt_date(a.case_due)}.")


def assess(inp: CaseInputs, cfg: Config, top_n: int = 3) -> Assessment:
    completion, due, delay, remaining = project(inp, cfg)
    f = factors(inp, cfg, completion, due, remaining)
    pts = points(f, cfg.weights)
    value = score(f, cfg.weights)
    a = Assessment(app_id=inp.app_id, score=value, band=band(value, cfg), factors={k: round(v, 3) for k, v in f.items()},
                   points={k: round(v, 1) for k, v in pts.items()}, projected_completion=completion, case_due=due,
                   projected_delay=delay, remaining_days=remaining, allowed_days=allowed_days(inp, cfg),
                   stage_late=max(0, (inp.today + timedelta(days=stage_rest(inp, cfg)) - inp.stage_due).days))
    ranked = sorted((k for k in FACTOR_ORDER if pts[k] >= 0.5), key=lambda k: (-pts[k], FACTOR_ORDER.index(k)))
    a.reasons = [{"code": k, "label": FACTOR_LABELS[k], "points": int(round(pts[k])),
                  "text": reason_text(k, inp, cfg, completion, due, remaining)} for k in ranked[:top_n]]
    a.summary = summary(inp, a)
    return a


# ------------------------------------------------------------------ waiting-time split
SPLIT_ORDER = ("institution", "official", "committee", "scheduling", "system")


def split_percent(days: dict[str, float]) -> dict[str, int]:
    """Whole percentages that add up to exactly 100 (largest remainder). Empty if there is no time at all."""
    clean = {k: max(0.0, float(days.get(k, 0.0))) for k in SPLIT_ORDER}
    total = sum(clean.values())
    if total <= 0:
        return {}
    raw = {k: 100.0 * v / total for k, v in clean.items()}
    out = {k: int(v) for k, v in raw.items()}
    short = 100 - sum(out.values())
    for k in sorted(SPLIT_ORDER, key=lambda k: (-(raw[k] - out[k]), SPLIT_ORDER.index(k)))[:short]:
        out[k] += 1
    return out


# ------------------------------------------------------------------ recommendation rules
def can_authorize(user: dict, authorized_by: str, region_id: int) -> bool:
    """Who may approve a recommendation. Enforced on the server; the UI only mirrors it."""
    if user.get("role") != "official":
        return False
    bureau = user.get("official_kind") == "bureau"
    regional = user.get("official_kind") == "regional" and user.get("region_id") == region_id
    if authorized_by == "bureau":
        return bureau
    if authorized_by == "regional":
        return regional
    return regional or bureau


def match_rules(inp: CaseInputs, a: Assessment, rules: list[dict], cfg: Config,
                officers: list[dict] | None = None) -> list[dict]:
    """Every active rule whose trigger holds for this case, best first (highest estimated days saved).
    Only cases at Medium or High risk get recommendations."""
    if a.band == "low":
        return []
    out = []
    for r in rules:
        if not r["active"]:
            continue
        hit = _trigger(r, inp, a, cfg, officers or [])
        if hit:
            out.append({"rule": r, **hit})
    out.sort(key=lambda m: (-m["rule"]["est_days_saved"], m["rule"]["id"]))
    return out


def _trigger(r: dict, inp: CaseInputs, a: Assessment, cfg: Config, officers: list[dict]) -> dict | None:
    code, n = r["code"], r["threshold"]
    saved = f"Estimate: about {r['est_days_saved']} days saved"
    if code == "silent_institution":
        if a.band == "high" and inp.open_deficiency_days is not None and inp.open_deficiency_days > n:
            return {"reason": f"High risk and the institution has not replied for {inp.open_deficiency_days} days.",
                    "effect": f"A priority reminder usually brings the reply sooner. {saved}.", "params": {}}
    elif code == "reviewer_overload":
        if inp.stage_code in ("intake", "scrutiny", "decision") and inp.assigned_to and inp.assignee_load > cfg.capacity:
            pool = [o for o in officers if o["id"] != inp.assigned_to and o["region_id"] == inp.region_id
                    and (inp.stage_code != "decision" or o["can_decide"])
                    and cfg.capacity and o["load"] * 100 < n * cfg.capacity]
            if pool:
                t = min(pool, key=lambda o: (o["load"], o["id"]))
                return {"reason": f"{inp.assignee} has {inp.assignee_load} open cases (capacity {cfg.capacity}); "
                                  f"{t['name']} has {t['load']}.",
                        "effect": f"Reassign to {t['name']}. {saved}.",
                        "params": {"target_id": t["id"], "target_name": t["name"], "target_load": t["load"]}}
    elif code == "evc_unscheduled":
        if inp.stage_code == "evc" and inp.visit_status in UNSCHEDULED_EVC and inp.stage_days >= n:
            step = {"assignment_pending": "assign the least-loaded expert members",
                    "availability_pending": "remind the members who have not confirmed dates",
                    "date_pending": "fix the earliest date all members can do"}[inp.visit_status]
            return {"reason": f"The case has been at the expert visit stage for {inp.stage_days} days and the visit "
                              f"is not scheduled.",
                    "effect": f"Approve to {step}. {saved}.", "params": {"visit_id": inp.visit_id,
                                                                          "visit_status": inp.visit_status}}
    elif code == "stage_ageing":
        expected = cfg.expected.get(inp.stage_code, 0)
        level = inp.escalation_level or 0
        if expected and level < 3 and inp.stage_days * 100 > n * expected:
            return {"reason": f"{inp.stage_days} days at {inp.stage_name}, more than {n} percent of the expected "
                              f"{expected} days.",
                    "effect": f"Bring it to level L{level + 1}. {saved}.", "params": {"level": level + 1}}
    elif code == "document_expiring":
        if inp.doc_expires is not None and inp.doc_expires <= a.projected_completion + timedelta(days=n):
            return {"reason": f"{inp.doc_title} expires on {fmt_date(inp.doc_expires)}, before the expected decision "
                              f"around {fmt_date(a.projected_completion)}.",
                    "effect": f"Ask the institution for the renewed document now. {saved}.",
                    "params": {"doc_id": inp.doc_id, "doc_title": inp.doc_title,
                               "doc_expires": inp.doc_expires.isoformat()}}
    return None


# ------------------------------------------------------------------ bottlenecks
def bottlenecks(rows: list[dict], top: int = 3) -> list[dict]:
    """Where projected delay is concentrated. `rows` carry stage_name, region, owner (officer or committee),
    institution, band, projected_delay and points. Groups by stage and Region, by owner and by institution,
    ranked by projected delay (or by high-risk count when nothing is projected late), keeping only groups that
    cover different cases."""
    total_delay = sum(r["projected_delay"] for r in rows)
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        groups.setdefault(("stage", f"{r['stage_name']} in {r['region']} Region"), []).append(r)
        if r.get("owner"):
            groups.setdefault(("owner", f"Cases with {r['owner']}"), []).append(r)
        groups.setdefault(("institution", f"Cases of {r['institution']}"), []).append(r)
    ranked = []
    for (kind, label), members in groups.items():
        delay = sum(m["projected_delay"] for m in members)
        high = sum(m["band"] == "high" for m in members)
        risky = [m for m in members if m["band"] != "low"]
        if (total_delay and delay == 0) or (not total_delay and not risky):
            continue
        cause_pts = {k: sum(m["points"].get(k, 0) for m in (risky or members)) for k in FACTOR_ORDER}
        cause = max(FACTOR_ORDER, key=lambda k: (cause_pts[k], -FACTOR_ORDER.index(k)))
        share = round(100 * delay / total_delay) if total_delay else 0
        late = sum(m["projected_delay"] > 0 for m in members)
        ranked.append({"kind": kind, "label": label, "cases": len(members), "high": high, "late": late,
                       "delay_days": delay, "share_pct": share, "cause": FACTOR_LABELS[cause].lower(),
                       "app_ids": sorted(m["app_id"] for m in members),
                       # the cases that make this group stand out: the late ones, or the risky ones if none is late
                       "core": {m["app_id"] for m in members
                                if (m["projected_delay"] > 0 if total_delay else m["band"] != "low")},
                       "key": (delay, high, sum(m["points"].get(cause, 0) for m in members))})
    kind_order = {"stage": 0, "owner": 1, "institution": 2}  # on a tie, the stage-and-Region view reads best
    ranked.sort(key=lambda g: (-g["key"][0], -g["key"][1], -g["key"][2], kind_order[g["kind"]], g["label"]))
    picked, seen = [], []
    for g in ranked:
        core = g.pop("core")
        if any(core <= s for s in seen):  # the same delayed cases are already explained by a better group
            continue
        seen.append(core)
        g.pop("key")
        n = g["high"] or g["late"] or g["cases"]
        what = "at high risk" if g["high"] else "projected late" if g["late"] else "at medium risk"
        cases = f"{n} case{'s' if n != 1 else ''} {what}"
        tail = f", {g['share_pct']} percent of projected delay" if total_delay else ""
        g["text"] = f"{g['label']}: {cases}{tail}; main cause: {g['cause']}."
        picked.append(g)
        if len(picked) == top:
            break
    return picked
