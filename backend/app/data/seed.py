"""Deterministic synthetic dataset.

The seed does not write finished states directly. It builds fictional regions, institutions and
people, then replays about 300 simulated days through the real engines: each day it runs the alert
tick and lets scripted "agents" (officers, committees, institutions) act according to per-case
plans. The result is consistent by construction: stage history, deficiencies, EVC visits,
undertakings, documents, alerts, escalations, notifications and the audit chain all come from real
engine calls. Same seed, same data.

Scripted demo cases (demo_tag on applications) make docs/DEMO.md work every time.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app import clock, compliance, documents, intelligence, rules, scheduling, workflow
from app.alerts import run_alert_tick
from app.audit import record
from app.clock import IST, SEED_NOW, ist_date
from app.common import DomainError
from app.data import people as P
from app.data.snapshot import load_dump
from app.data.snapshot import save as save_snapshot
from app.workflow import committee
from db import Conn, init_schema

SEED = 26262
START_DAY = -300  # days before SEED_NOW when the simulation starts
SEED_DATE = SEED_NOW.date()
CURRENT_AY = "2026-27"
LEGACY_AY = "2025-26"


def day_of(dt) -> int:
    return (ist_date(dt) - SEED_DATE).days


def at_day(d: int) -> datetime:
    return SEED_NOW + timedelta(days=d)


def date_of(d: int) -> date:
    return SEED_DATE + timedelta(days=d)


# ------------------------------------------------------------------ plans
@dataclass
class EvcPlan:
    assign: int | None = 3
    avail: list[int | None] = field(default_factory=lambda: [1, 2, 2])
    schedule: int | None = 2
    offer_base: int = 20          # visit date = assignment day + offer_base
    conduct_late: int | None = 0  # days after the visit date the visit is marked conducted
    report: int | None = 3
    review: int | None = 2
    report_outcome: str = "satisfactory"
    members: list[str] | None = None  # user codes, first is convenor


@dataclass
class AppPlan:
    inst: str
    app_type: str
    submit: int
    ay: str = CURRENT_AY
    tag: str | None = None
    intake: int | None = 3
    intake_def: int | None = None
    scrutiny: int | None = 12
    scrutiny_def: int | None = None
    reply: int | None = 6
    rereview: int | None = 3
    evc: EvcPlan = field(default_factory=EvcPlan)
    sac: int | None = 6
    sac_members: list[str] | None = None
    sac_rec: str = "recommend_approval"
    decision: int | None = 3
    outcome: str = "approved"
    undertakings: list[tuple[str, int | None, str]] = field(default_factory=list)  # (condition, due day, behaviour)
    assign_to: str | None = None
    # runtime
    app_id: int | None = None
    done: set = field(default_factory=set)


def scripted_plans() -> list[AppPlan]:
    return [
        # Institution demo: application in scrutiny with the demo officer, no deficiency yet.
        AppPlan(tag="demo_scrutiny", inst="AMB", app_type="INTAKE", submit=-12, intake=2, scrutiny=None,
                assign_to="off-NR-1"),
        # Returned application waiting on the institution; reply overdue, at L1 (L2 in two days).
        AppPlan(tag="demo_returned", inst="IRO", app_type="EOA", submit=-35, intake=3, scrutiny=None,
                scrutiny_def=4, reply=None),
        # Overdue scrutiny (5 days late, L1).
        AppPlan(tag="demo_overdue_scrutiny", inst="VAL", app_type="NEW", submit=-30, intake=4, scrutiny=None),
        # Case already at L2 escalation (scrutiny 11 days late; L3 in three days).
        AppPlan(tag="demo_l2", inst="COP", app_type="INTAKE", submit=-36, intake=4, scrutiny=None),
        # Delayed EVC: visit date passed five days ago and the visit is not marked conducted.
        AppPlan(tag="demo_evc_delayed", inst="QUI", app_type="INTAKE", submit=-75, intake=3, scrutiny=15,
                evc=EvcPlan(assign=4, avail=[1, 2, 2], schedule=2, offer_base=48, conduct_late=None)),
        # Committee demo: the demo EVC member has not confirmed availability yet.
        AppPlan(tag="demo_visit_availability", inst="BRI", app_type="RESTORE", submit=-10, intake=3,
                evc=EvcPlan(assign=4, avail=[None, 1, 1], schedule=2, offer_base=20,
                            members=["evc-1", "evc-2", "evc-3"])),
        # Committee demo: visit is today; convenor marks it conducted and submits the report.
        AppPlan(tag="demo_visit_report", inst="CED", app_type="LOCATION", submit=-40, intake=3,
                evc=EvcPlan(assign=3, avail=[1, 1, 2], schedule=1, offer_base=34, conduct_late=None,
                            members=["evc-1", "evc-4", "evc-5"])),
        # Committee demo: SAC/SHC review waiting for the demo SAC member.
        AppPlan(tag="demo_sac", inst="YAR", app_type="LOCATION", submit=-60, intake=3,
                evc=EvcPlan(assign=2, avail=[1, 1, 1], schedule=1, offer_base=47, conduct_late=0, report=3,
                            review=2, report_outcome="deficiencies_noted"),
                sac=None, sac_members=["sac-1", "sac-2"]),
        # Official demo: decision stage with the Regional Director; committee recommended undertakings.
        AppPlan(tag="demo_decision", inst="DAW", app_type="NEW", submit=-60, intake=3, scrutiny=12, scrutiny_def=5,
                reply=4, rereview=3,
                evc=EvcPlan(assign=2, avail=[1, 1, 2], schedule=1, offer_base=23, conduct_late=0, report=3, review=2),
                sac=13, sac_rec="recommend_with_undertakings", decision=None),
        # Ambervale's earlier approval: one undertaking due in 5 days with no evidence yet.
        AppPlan(tag="demo_legacy", inst="AMB", app_type="INTAKE", submit=-295, ay=LEGACY_AY, intake=3, scrutiny=14,
                evc=EvcPlan(assign=3, avail=[1, 2, 1], schedule=1, offer_base=20, conduct_late=0, report=4, review=3),
                decision=4, outcome="approved_with_undertakings",
                undertakings=[(P.UNDERTAKING_CONDITIONS[2], 5, "never"),
                              (P.UNDERTAKING_CONDITIONS[6], -120, "prompt")]),
        # Evidence waiting for verification by an official.
        AppPlan(tag="demo_verification", inst="JUN", app_type="EOA", submit=-290, ay=LEGACY_AY, intake=2, scrutiny=10,
                decision=3, outcome="approved_with_undertakings",
                undertakings=[(P.UNDERTAKING_CONDITIONS[5], 25, "pending_verification")]),
        # Undertaking 10 days overdue with no evidence (L1 now, L2 in five days).
        AppPlan(tag="demo_overdue_undertaking", inst="WIL", app_type="EOA", submit=-285, ay=LEGACY_AY, intake=2,
                scrutiny=9, decision=2, outcome="approved_with_undertakings",
                undertakings=[(P.UNDERTAKING_CONDITIONS[7], -10, "never")]),
    ]

# Institutions whose cases are fully scripted for the demo (no random cases are added to them).
SCRIPTED_ONLY = {"AMB"}


TYPE_WEIGHTS = [("EOA", 25), ("NAME_CHANGE", 5), ("INTAKE", 25), ("NEW", 15), ("LOCATION", 10), ("MERGER", 5),
                ("RESTORE", 15)]


def _maybe(rng: random.Random, p_none: float, lo: int, hi: int) -> int | None:
    return None if rng.random() < p_none else rng.randint(lo, hi)


def generic_plan(rng: random.Random, inst: str, submit: int, ay: str, legacy: bool) -> AppPlan:
    types, weights = zip(*TYPE_WEIGHTS, strict=True)
    app_type = rng.choices(types, weights)[0]
    slow = 0.12
    never = 0.0 if legacy else 0.03
    p = AppPlan(inst=inst, app_type=app_type, submit=submit, ay=ay)
    p.intake = rng.randint(1, 5) if rng.random() > slow else rng.randint(8, 12)
    p.intake_def = rng.randint(1, 2) if rng.random() < 0.15 else None
    p.scrutiny = rng.randint(9, 20) if rng.random() > slow else rng.randint(23, 32)
    p.scrutiny_def = rng.randint(3, 6) if rng.random() < 0.55 else None
    p.reply = _maybe(rng, never * 1.5, 3, 13)
    p.rereview = rng.randint(2, 7)
    p.evc = EvcPlan(
        assign=rng.randint(1, 5) if rng.random() > slow else rng.randint(8, 11),
        avail=[_maybe(rng, never, 1, 4) for _ in range(3)],
        schedule=rng.randint(1, 3),
        offer_base=rng.randint(12, 28),
        conduct_late=_maybe(rng, never, 0, 1),
        report=_maybe(rng, never, 1, 5),
        review=rng.randint(1, 4),
        report_outcome=rng.choices(["satisfactory", "deficiencies_noted", "not_satisfactory"], [70, 25, 5])[0],
    )
    p.sac = rng.randint(3, 12)
    p.decision = rng.randint(1, 6)
    if legacy:
        p.outcome = rng.choices(["approved", "approved_with_undertakings", "not_approved"], [3, 8, 1])[0]
    else:
        p.outcome = rng.choices(["approved", "approved_with_undertakings", "not_approved"], [55, 30, 15])[0]
    p.sac_rec = {"approved": "recommend_approval", "approved_with_undertakings": "recommend_with_undertakings",
                 "not_approved": "recommend_not_approval"}[p.outcome]
    if p.outcome == "approved_with_undertakings":
        n = 1 if rng.random() < (0.5 if legacy else 0.7) else 2
        conds = rng.sample(P.UNDERTAKING_CONDITIONS, n)
        p.undertakings = [(c, rng.randint(-100, 200) if legacy else None, "auto") for c in conds]
    return p


# ------------------------------------------------------------------ the simulation
class Sim:
    def __init__(self, conn: Conn, rng: random.Random):
        self.conn = conn
        self.rng = rng
        self.users: dict[str, dict] = {}
        self.by_id: dict[int, dict] = {}
        self.inst_ids: dict[str, int] = {}
        self.plans: list[AppPlan] = []
        self.u_behaviour: dict[int, dict] = {}
        self.d_behaviour: dict[int, dict] = {}
        self.day = START_DAY
        # A separate generator for the officers who act on recommendations, so adding them leaves every
        # other random draw (cases, people, plans) exactly as before.
        self.irng = random.Random(SEED * 7 + 1)

    @property
    def now(self) -> datetime:
        return at_day(self.day)

    def user(self, uid: int) -> dict:
        return self.by_id[uid]

    def inst_user(self, institution_id: int) -> dict:
        return next(u for u in self.by_id.values() if u["role"] == "institution" and u["institution_id"] == institution_id)

    def region_officer(self, region_id: int) -> dict:
        return min((u for u in self.by_id.values() if u["role"] == "official" and u["official_kind"] == "regional"
                    and u["rank"] == 1 and u["region_id"] == region_id), key=lambda u: u["id"])

    def region_director(self, region_id: int) -> dict:
        return next(u for u in self.by_id.values() if u["role"] == "official" and u["official_kind"] == "regional"
                    and u["rank"] == 2 and u["region_id"] == region_id)

    def pdf(self, title: str, *lines: str) -> bytes:
        return documents.tiny_pdf(title, ["SYNTHETIC DATA - fictional document for the Argus prototype", *lines])

    # -------------------------------------------------------------- applications
    def act_on_application(self, p: AppPlan) -> None:
        c, now, d = self.conn, self.now, self.day
        if p.app_id is None:
            if d < p.submit:
                return
            actor = self.inst_user(self.inst_ids[p.inst])
            inst = c.one("SELECT kind FROM institutions WHERE id = %s", (actor["institution_id"],))
            programme = self.rng.choice(P.PROGRAMMES[inst["kind"]])
            p.app_id = workflow.submit_application(c, now, actor, app_type=p.app_type, programme=programme,
                                                   academic_year=p.ay, demo_tag=p.tag)
            documents.store(c, now, actor, entity_type="application", entity_id=p.app_id, slot="application_form",
                            filename="application-form.pdf", content_type="application/pdf",
                            data=self.pdf("Application form", f"Programme: {programme}"),
                            institution_id=actor["institution_id"], application_id=p.app_id)
            return
        app = workflow.get_application(c, p.app_id)
        if app["status"] != "in_progress":
            return
        st = c.one("SELECT * FROM application_stages WHERE id = %s", (app["current_stage_id"],))
        code, since = st["stage_code"], d - day_of(st["started_at"])
        officer = self.user(st["assigned_to"]) if st["assigned_to"] else None

        if p.assign_to and code == "scrutiny" and ("assign", st["id"]) not in p.done:
            p.done.add(("assign", st["id"]))
            target = self.users[p.assign_to]
            if st["assigned_to"] != target["id"]:
                workflow.reassign(c, now, self.region_director(app["region_id"]), app["id"], target["id"])
            return

        if code in ("intake", "scrutiny"):
            review_days = p.intake if code == "intake" else p.scrutiny
            def_after = p.intake_def if code == "intake" else p.scrutiny_def
            if st["substatus"] == "in_review":
                raised = c.val("SELECT count(*) FROM deficiencies WHERE stage_id = %s", (st["id"],))
                if def_after is not None and not raised:
                    if since >= def_after:
                        workflow.raise_deficiency(c, now, officer, app["id"], self.rng.choice(P.DEFICIENCY_REASONS))
                elif review_days is not None and since >= review_days:
                    workflow.complete_review(c, now, officer, app["id"], "Scrutiny completed; documents in order.")
            elif st["substatus"] == "awaiting_institution":
                dfc = c.one("SELECT * FROM deficiencies WHERE stage_id = %s AND status = 'open'", (st["id"],))
                if p.reply is not None and d - day_of(dfc["raised_at"]) >= p.reply:
                    actor = self.inst_user(app["institution_id"])
                    f = documents.store(c, now, actor, entity_type="deficiency", entity_id=dfc["id"], slot="reply",
                                        filename="reply-documents.pdf", content_type="application/pdf",
                                        data=self.pdf("Reply to deficiency", app["ref_no"]),
                                        institution_id=app["institution_id"], application_id=app["id"])
                    workflow.respond_deficiency(c, now, actor, dfc["id"], self.rng.choice(P.REPLIES), [f["id"]])
            elif st["substatus"] == "re_review":
                last = c.one("SELECT responded_at FROM deficiencies WHERE stage_id = %s ORDER BY id DESC LIMIT 1",
                             (st["id"],))
                if p.rereview is not None and d - day_of(last["responded_at"]) >= p.rereview:
                    workflow.complete_review(c, now, officer, app["id"], "Re-scrutiny completed after the reply.")
        elif code == "evc":
            self.act_on_visit(p, app, st, officer)
        elif code == "sac":
            review = c.one("SELECT * FROM committee_reviews WHERE stage_id = %s AND status = 'pending'", (st["id"],))
            if p.sac_members and ("sac", review["id"]) not in p.done:
                p.done.add(("sac", review["id"]))
                committee.reassign_members(c, now, self.region_director(app["region_id"]), review["id"],
                                           [self.users[m]["id"] for m in p.sac_members])
                return
            if p.sac is not None and since >= p.sac:
                member = c.val("SELECT user_id FROM committee_members WHERE review_id = %s ORDER BY user_id LIMIT 1",
                               (review["id"],))
                committee.recommend(c, now, self.user(member), review["id"], p.sac_rec,
                                    "Committee considered the case summary and the visit report.")
        elif code == "decision":
            if p.decision is not None and since >= p.decision:
                unds = [{"condition": cond, "due_date": date_of(due if due is not None else d + self.rng.randint(60, 240))}
                        for cond, due, _ in p.undertakings]
                ids = workflow.record_decision(c, now, officer, app["id"], p.outcome, P.DECISION_REASONS[p.outcome],
                                               unds)
                for uid, (_, _, behaviour) in zip(ids, p.undertakings, strict=True):
                    self.u_behaviour[uid] = self.undertaking_behaviour(uid, behaviour)

    def act_on_visit(self, p: AppPlan, app: dict, st: dict, officer: dict) -> None:
        c, now, d, e = self.conn, self.now, self.day, p.evc
        v = c.one("SELECT * FROM evc_visits WHERE stage_id = %s AND status <> 'cancelled'", (st["id"],))
        since = d - day_of(v["step_started_at"])
        if v["status"] == "assignment_pending":
            if e.assign is not None and since >= e.assign:
                if e.members:
                    ids = [self.users[m]["id"] for m in e.members]
                else:
                    pool = sorted(u["id"] for u in self.by_id.values() if u["committee_kind"] == "EVC")
                    ids = self.rng.sample(pool, 3)
                scheduling.assign_members(c, now, officer, v["id"], ids, ids[0])
        elif v["status"] == "availability_pending":
            assigned_day = day_of(v["assigned_at"])
            offered = [date_of(assigned_day + e.offer_base + k) for k in (0, 2, 4)]
            members = c.all("SELECT user_id FROM evc_members WHERE visit_id = %s ORDER BY is_convenor DESC, user_id",
                            (v["id"],))
            for i, m in enumerate(members):
                delay = e.avail[i] if i < len(e.avail) else 1
                row = c.one("SELECT availability FROM evc_members WHERE visit_id = %s AND user_id = %s",
                            (v["id"], m["user_id"]))
                if row["availability"] == "pending" and delay is not None and since >= delay:
                    scheduling.respond_availability(c, now, self.user(m["user_id"]), v["id"], True, offered)
        elif v["status"] == "date_pending":
            if e.schedule is not None and since >= e.schedule:
                options = [x for x in scheduling.common_dates(c, v["id"]) if x > date_of(d)]
                if options:
                    scheduling.schedule_visit(c, now, officer, v["id"], options[0])
        elif v["status"] == "scheduled":
            if e.conduct_late is not None and d >= (v["visit_date"] - SEED_DATE).days + e.conduct_late:
                convenor = c.val("SELECT user_id FROM evc_members WHERE visit_id = %s AND is_convenor", (v["id"],))
                scheduling.mark_conducted(c, now, self.user(convenor), v["id"])
        elif v["status"] == "report_pending":
            if e.report is not None and since >= e.report:
                convenor = self.user(c.val("SELECT user_id FROM evc_members WHERE visit_id = %s AND is_convenor",
                                           (v["id"],)))
                f = documents.store(c, now, convenor, entity_type="evc_visit", entity_id=v["id"], slot="visit_report",
                                    filename="evc-visit-report.pdf", content_type="application/pdf",
                                    data=self.pdf("EVC visit report", app["ref_no"]),
                                    institution_id=app["institution_id"], application_id=app["id"])
                findings = P.FINDINGS[e.report_outcome][self.rng.randrange(4)]
                scheduling.submit_report(c, now, convenor, v["id"], findings, e.report_outcome, f["id"])
        elif v["status"] == "report_submitted":
            if e.review is not None and since >= e.review:
                scheduling.review_report(c, now, officer, v["id"], "Visit report reviewed and placed on record.")

    # -------------------------------------------------------------- recommendations (synthetic history)
    def act_on_interventions(self) -> None:
        """Scripted officers approve or dismiss open recommendations on the generic (non-demo) cases, and the
        people involved respond the way the action implies. This gives the history real interventions with
        measured outcomes. Demo cases are left alone so docs/DEMO.md stays the same."""
        c, now, d = self.conn, self.now, self.day
        by_app = {p.app_id: p for p in self.plans if p.app_id is not None}
        rows = c.all("""SELECT i.id, i.application_id, i.action, i.params, i.created_at, r.authorized_by, a.region_id
                        FROM interventions i JOIN intervention_rules r ON r.id = i.rule_id
                        JOIN applications a ON a.id = i.application_id
                        WHERE i.status = 'open' ORDER BY i.id""")
        for iv in rows:
            plan = by_app.get(iv["application_id"])
            if plan is None or plan.tag or d - day_of(iv["created_at"]) < 1:
                continue
            roll = self.irng.random()
            actor = self.region_officer(iv["region_id"]) if roll < 0.35 else self.region_director(iv["region_id"])
            if roll < 0.62:
                try:
                    intelligence.approve(c, now, actor, iv["id"])
                except DomainError:
                    intelligence.dismiss(c, now, actor, iv["id"], "Cannot be carried out at this point in the case.")
                    continue
                self.respond_to(plan, iv)
            elif roll < 0.75:
                intelligence.dismiss(c, now, actor, iv["id"], self.irng.choice(P.DISMISS_REASONS))

    def respond_to(self, p: AppPlan, iv: dict) -> None:
        """How the synthetic participants react to an approved intervention (assumed behaviour)."""
        c, d = self.conn, self.day
        app = workflow.get_application(c, p.app_id)
        st = c.one("SELECT * FROM application_stages WHERE id = %s", (app["current_stage_id"],))
        since = d - day_of(st["started_at"])
        quick = self.irng.randint(2, 4)
        if iv["action"] == "priority_reminder":
            dfc = c.one("SELECT raised_at FROM deficiencies WHERE stage_id = %s AND status = 'open'", (st["id"],))
            if dfc:
                p.reply = d - day_of(dfc["raised_at"]) + quick
        elif iv["action"] in ("reassign", "escalate"):
            if st["stage_code"] == "intake":
                p.intake = min(p.intake if p.intake is not None else 999, since + quick)
            elif st["stage_code"] == "scrutiny":
                p.scrutiny = min(p.scrutiny if p.scrutiny is not None else 999, since + quick)
                p.rereview = min(p.rereview if p.rereview is not None else 999, quick)
            elif st["stage_code"] == "decision":
                p.decision = min(p.decision if p.decision is not None else 999, since + quick)
            elif st["stage_code"] == "sac":
                p.sac = min(p.sac if p.sac is not None else 999, since + quick)
        elif iv["action"] == "propose_visit_slot":
            v = c.one("SELECT status, step_started_at FROM evc_visits WHERE stage_id = %s AND status <> 'cancelled'",
                      (st["id"],))
            if v and v["status"] == "availability_pending":
                step = d - day_of(v["step_started_at"])
                p.evc.avail = [step + self.irng.randint(1, 2) for _ in range(3)]
        elif iv["action"] == "request_document":
            doc_id = (iv["params"] or {}).get("doc_id")
            if doc_id in self.d_behaviour:
                self.d_behaviour[doc_id].update({"mode": "fixed", "day": d + quick, "years": self.irng.randint(1, 3),
                                                 "verify": self.irng.randint(1, 4), "once": True})

    # -------------------------------------------------------------- undertakings
    def undertaking_behaviour(self, uid: int, kind: str) -> dict:
        u = self.conn.one("SELECT due_at, created_at FROM undertakings WHERE id = %s", (uid,))
        due, created = day_of(u["due_at"]), day_of(u["created_at"])
        r = random.Random(SEED * 31 + uid)
        if kind == "never":
            return {"evidence": None}
        if kind == "pending_verification":
            return {"evidence": -2, "review": None, "resubmit_first": False}
        if kind == "prompt":
            return {"evidence": max(created + 5, due - 20), "review": 3, "resubmit_first": False, "resubmit": 4}
        if r.random() < 0.18:
            return {"evidence": None}
        ev = due + r.randint(-45, 8)
        return {"evidence": max(ev, created + r.randint(5, 20)), "review": r.randint(1, 6),
                "resubmit_first": r.random() < 0.2, "resubmit": r.randint(3, 8)}

    def act_on_undertakings(self) -> None:
        c, now, d = self.conn, self.now, self.day
        for u in c.all("""SELECT u.*, i.region_id FROM undertakings u JOIN institutions i ON i.id = u.institution_id
                          WHERE u.status <> 'verified' ORDER BY u.id"""):
            b = self.u_behaviour.get(u["id"]) or {"evidence": None}
            inst_user = self.inst_user(u["institution_id"])
            if u["status"] == "open" and b["evidence"] is not None and d >= b["evidence"]:
                self._upload_evidence(u, inst_user)
            elif u["status"] == "resubmission_requested":
                last = c.one("SELECT reviewed_at FROM evidence_submissions WHERE undertaking_id = %s ORDER BY id DESC LIMIT 1",
                             (u["id"],))
                if d - day_of(last["reviewed_at"]) >= b.get("resubmit", 5):
                    self._upload_evidence(u, inst_user)
            elif u["status"] == "evidence_submitted" and b.get("review") is not None:
                last = c.one("SELECT submitted_at FROM evidence_submissions WHERE undertaking_id = %s ORDER BY id DESC LIMIT 1",
                             (u["id"],))
                if d - day_of(last["submitted_at"]) >= b["review"]:
                    n = c.val("SELECT count(*) FROM evidence_submissions WHERE undertaking_id = %s", (u["id"],))
                    reject = b.get("resubmit_first") and n == 1
                    compliance.review_evidence(c, now, self.region_officer(u["region_id"]), u["id"], not reject,
                                               "The evidence does not cover the full condition. Upload the complete "
                                               "document." if reject else "Evidence verified against the condition.")

    def _upload_evidence(self, u: dict, actor: dict) -> None:
        f = documents.store(self.conn, self.now, actor, entity_type="undertaking", entity_id=u["id"], slot="evidence",
                            filename="compliance-evidence.pdf", content_type="application/pdf",
                            data=self.pdf("Evidence of compliance", u["condition_text"][:80]),
                            institution_id=u["institution_id"], application_id=u["application_id"])
        compliance.submit_evidence(self.conn, self.now, actor, u["id"], f["id"], "Evidence of compliance uploaded.")

    # -------------------------------------------------------------- tracked documents
    def act_on_documents(self) -> None:
        c, now, d = self.conn, self.now, self.day
        for t in c.all("""SELECT t.*, i.region_id FROM tracked_documents t JOIN institutions i ON i.id = t.institution_id
                          ORDER BY t.id"""):
            b = self.d_behaviour[t["id"]]
            exp = (t["expires_on"] - SEED_DATE).days
            if t["status"] in ("valid", "renewal_rejected"):
                if t["status"] == "renewal_rejected":
                    due_day = b.get("rejected_on", d) + 5
                elif b["mode"] == "renew":
                    due_day = exp - b["lead"]
                elif b["mode"] == "late":
                    due_day = exp + b["late"]
                elif b["mode"] == "fixed":
                    due_day = b["day"]
                else:
                    continue
                if d >= due_day:
                    actor = self.inst_user(t["institution_id"])
                    f = documents.store(c, now, actor, entity_type="tracked_document", entity_id=t["id"], slot="renewal",
                                        filename=f"{t['doc_type']}-renewed.pdf", content_type="application/pdf",
                                        data=self.pdf(f"Renewed {t['title']}", f"Issued by {t['issued_by']}"),
                                        institution_id=t["institution_id"], application_id=None)
                    new_exp = t["expires_on"] + timedelta(days=365 * b["years"])
                    while new_exp <= date_of(d):
                        new_exp += timedelta(days=365)
                    compliance.submit_renewal(c, now, actor, t["id"], f["id"], new_exp)
                    if b.pop("once", False):  # a renewal sent after a document request goes back to normal habits
                        b.update({"mode": "renew", "lead": 20})
            elif t["status"] == "renewal_submitted" and b.get("verify") is not None:
                if d - day_of(t["renewal_submitted_at"]) >= b["verify"]:
                    reject = b.get("reject_first") and not b.get("rejected_once")
                    officer = self.region_officer(t["region_id"])
                    if reject:
                        b["rejected_once"] = True
                        b["rejected_on"] = d
                        compliance.review_renewal(c, now, officer, t["id"], False,
                                                  "The renewed document is not signed by the issuing authority.")
                    else:
                        compliance.review_renewal(c, now, officer, t["id"], True, "Renewed document verified.")

    # -------------------------------------------------------------- setup
    def create_people(self) -> None:
        c = self.conn
        region_ids = {}
        for code, name in P.REGIONS:
            region_ids[code] = c.val("INSERT INTO regions (code, name) VALUES (%s,%s) RETURNING id", (code, name))
        names = self._name_pool()
        for town, rcode, suffix, kind in P.INSTITUTIONS:
            code = "".join(ch for ch in town.upper() if ch.isalpha())[:3]
            iid = c.val("""INSERT INTO institutions (code, name, region_id, city, kind, established_year)
                           VALUES (%s,%s,%s,%s,%s,%s) RETURNING id""",
                        (code, f"{town} {suffix}", region_ids[rcode], town, kind, self.rng.randint(1985, 2016)))
            self.inst_ids[code] = iid
            pname = "Dr. Kavya Larkspur" if code == "AMB" else f"Dr. {next(names)}"
            slug = town.lower().replace(" ", "")
            self._user(f"inst-{code}", pname, "institution", f"Principal, {town} {suffix}", institution_id=iid,
                       email=f"principal@{slug}.example", featured=code == "AMB",
                       phone_valid=code not in ("UMB", "OPA"))
        for code, rname in P.REGIONS:
            rid = region_ids[code]
            officers = 2 if code == "NR" else 1
            for k in range(1, officers + 1):
                if code == "NR" and k == 1:
                    name = "Arjun Wrenfield"
                elif code == "NR" and k == 2:
                    name = "Meera Quillon"
                else:
                    name = next(names)
                self._user(f"off-{code}-{k}", name, "official", f"Assistant Director, {rname} Region",
                           official_kind="regional", rank=1, region_id=rid, featured=(code == "NR" and k == 1))
            name = "Dr. Nandini Hazelbrook" if code == "NR" else f"Dr. {next(names)}"
            self._user(f"rd-{code}", name, "official", f"Regional Director, {rname} Region", official_kind="regional",
                       rank=2, region_id=rid, featured=code == "NR")
        self._user("bureau-officer", "Kabir Lumenhart", "official", "Deputy Director, Approval Bureau",
                   official_kind="bureau", rank=2)
        self._user("bureau-head", "Ritu Emberly", "official", "Advisor and Bureau Head, Approval Bureau",
                   official_kind="bureau", rank=3, featured=True)
        for k in range(1, 9):
            name = "Prof. Vikram Duskwood" if k == 1 else f"Prof. {next(names)}"
            self._user(f"evc-{k}", name, "committee", "Expert member, Expert Visit Committee", committee_kind="EVC",
                       featured=k == 1)
        for k in range(1, 5):
            name = "Dr. Sana Thistledown" if k == 1 else f"Dr. {next(names)}"
            self._user(f"sac-{k}", name, "committee", "Member, SAC/SHC", committee_kind="SAC", featured=k == 1)

    def _name_pool(self):
        reserved = {"Kavya Larkspur", "Arjun Wrenfield", "Meera Quillon", "Nandini Hazelbrook", "Kabir Lumenhart",
                    "Ritu Emberly", "Vikram Duskwood", "Sana Thistledown"}
        reserved_surnames = {n.split()[-1] for n in reserved}
        seen = set()
        for i in range(1600):
            g = P.GIVEN[(i * 7 + 3) % len(P.GIVEN)]
            s = P.SURNAMES[(i * 13 + (i // len(P.GIVEN)) * 3 + 5) % len(P.SURNAMES)]
            name = f"{g} {s}"
            if s in reserved_surnames or name in seen:
                continue
            seen.add(name)
            yield name

    def _user(self, code: str, name: str, role: str, designation: str, **kw) -> None:
        n = len(self.users) + 1
        email = kw.pop("email", None) or f"{code}@aicte-demo.example"
        row = {"official_kind": None, "rank": None, "committee_kind": None, "region_id": None, "institution_id": None,
               "phone_valid": True, "featured": False, **kw}
        uid = self.conn.val(
            """INSERT INTO users (code, name, role, designation, official_kind, rank, committee_kind, region_id,
                                  institution_id, email, phone, phone_valid, featured)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (code, name, role, designation, row["official_kind"], row["rank"], row["committee_kind"], row["region_id"],
             row["institution_id"], email, f"+91 90000 {n:05d}", row["phone_valid"], row["featured"]),
        )
        user = self.conn.one("SELECT * FROM users WHERE id = %s", (uid,))
        self.users[code] = user
        self.by_id[uid] = user

    def create_documents(self) -> None:
        c, now = self.conn, self.now
        scripted = {"AMB": ("land_lease", 20, {"mode": "never"}),
                    "RIV": ("land_lease", -12, {"mode": "never"}),
                    "OAK": ("fire_noc", 10, {"mode": "fixed", "day": -3, "years": 1, "verify": None})}
        types = list(compliance.DOC_TYPES)
        for code, iid in self.inst_ids.items():
            if code in scripted:
                doc_type, exp, beh = scripted[code]
            else:
                doc_type = self.rng.choices(types, [55, 20, 10, 10, 5])[0]
                exp = self.rng.randint(-250, 420)
                roll = self.rng.random()
                if roll < 0.78:
                    beh = {"mode": "renew", "lead": self.rng.randint(5, 40)}
                elif roll < 0.9:
                    beh = {"mode": "late", "late": self.rng.randint(3, 20)}
                else:
                    beh = {"mode": "never"}
                beh.update({"years": self.rng.randint(1, 3), "verify": self.rng.randint(1, 7),
                            "reject_first": self.rng.random() < 0.12})
            title = compliance.DOC_TYPES[doc_type]
            expires = date_of(exp)
            issued_by = {"land_lease": "Sub-Registrar of Assurances (fictional)", "fire_noc": "District Fire Services (fictional)",
                         "building_stability": "Chartered structural engineer (fictional)",
                         "affiliation": "Affiliating University (fictional)",
                         "bank_guarantee": "Scheduled bank (fictional)"}[doc_type]
            did = c.val(
                """INSERT INTO tracked_documents (institution_id, doc_type, title, issued_by, valid_from, expires_on,
                                                  status, tracked_since)
                   VALUES (%s,%s,%s,%s,%s,%s,'valid',%s) RETURNING id""",
                (iid, doc_type, title, issued_by, expires - timedelta(days=365 * 3), expires, now),
            )
            actor = self.inst_user(iid)
            f = documents.store(c, now, actor, entity_type="tracked_document", entity_id=did, slot="current",
                                filename=f"{doc_type}.pdf", content_type="application/pdf",
                                data=self.pdf(title, f"Valid until {expires.isoformat()}"),
                                institution_id=iid, application_id=None)
            c.run("UPDATE tracked_documents SET file_id = %s WHERE id = %s", (f["id"], did))
            record(c, at=now, actor=None, action="document.tracking_started", entity_type="tracked_document",
                   entity_id=did, details={"institution_id": iid, "doc_type": doc_type,
                                           "expires_on": expires.isoformat()})
            self.d_behaviour[did] = beh

    def build_plans(self) -> None:
        plans = scripted_plans()
        codes = [c for c in self.inst_ids if c not in SCRIPTED_ONLY]
        legacy_count = 13
        current_count = 60 - len(plans) - legacy_count
        for _ in range(legacy_count):
            plans.append(generic_plan(self.rng, self.rng.choice(codes), self.rng.randint(-298, -262), LEGACY_AY, True))
        for _ in range(current_count):
            plans.append(generic_plan(self.rng, self.rng.choice(codes), self.rng.randint(-65, -2), CURRENT_AY, False))
        plans.sort(key=lambda p: (p.submit, p.tag or "", p.inst))
        self.plans = plans


def generate(conn: Conn, progress=print) -> dict:
    """Rebuild the dataset by replaying the simulation (about 34k queries; run it against a local database)."""
    init_schema(conn)
    rng = random.Random(SEED)
    sim = Sim(conn, rng)
    clock.init_clock(conn, sim.now)
    rules.seed_defaults(conn, effective_from=date_of(START_DAY))
    sim.create_people()
    record(conn, at=sim.now, actor=None, action="dataset.created", entity_type="dataset", entity_id="synthetic",
           details={"seed": SEED, "note": "SYNTHETIC DATA. All institutions and people are fictional.",
                    "rules": "Illustrative assumptions, not official APH figures."})
    sim.create_documents()
    sim.build_plans()

    for d in range(START_DAY, 1):
        sim.day = d
        clock.set_now(conn, sim.now)
        run_alert_tick(conn, sim.now)
        sim.act_on_interventions()
        for p in sim.plans:
            sim.act_on_application(p)
        sim.act_on_undertakings()
        sim.act_on_documents()
        if d % 50 == 0:
            progress(f"  simulated up to day {d} ({date_of(d).isoformat()})")
    run_alert_tick(conn, sim.now)
    # Wall-clock throttle time is not part of the dataset; clearing it keeps the dump byte-identical.
    conn.run("UPDATE platform_clock SET last_tick_wall = NULL")
    save_snapshot(conn)
    conn.commit()
    return counts(conn)


def load(conn: Conn) -> dict:
    """Load the committed dataset (data/seed.copy.gz) and take the Reset snapshot. A few round trips."""
    init_schema(conn)
    load_dump(conn)
    save_snapshot(conn)
    conn.commit()
    return counts(conn)


def counts(conn: Conn) -> dict:
    return {t: conn.val(f"SELECT count(*) FROM {t}") for t in (
        "institutions", "users", "applications", "evc_visits", "undertakings", "tracked_documents", "alerts",
        "escalations", "notifications", "risk_assessments", "interventions", "intervention_outcomes", "audit_log")}


__all__ = ["generate", "load", "SEED_NOW", "IST"]
