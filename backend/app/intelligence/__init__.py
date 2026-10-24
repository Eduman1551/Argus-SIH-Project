"""Proactive workflow intelligence: delay-risk assessment, bottlenecks, recommended interventions and outcomes.

Flow: workflow processing -> delay-risk assessment -> bottleneck identification -> recommended intervention
-> authorised action (a permitted human approves) -> outcome tracking.

The alert tick calls `on_tick` once per simulated day: it assesses every open application with the pure
functions in `scoring`, stores the assessment, keeps one open recommendation per at-risk case, and
re-measures approved interventions 7 days later and when the case is decided. Pages compute the same
assessment live on read. Nothing is executed automatically: a recommendation only runs when a permitted
official approves it, through the same engine functions and permission checks as the manual action.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from app import notifications, scheduling, workflow
from app.audit import record
from app.clock import ist_date
from app.common import (
    InvalidAction,
    NotAllowed,
    NotFound,
    bureau_head,
    bureau_officer,
    ensure,
    fmt_date,
    institution_users,
    region_director,
    require_text,
)
from app.intelligence import scoring as S
from app.rules import setting
from db import Conn

HISTORY_WINDOW_DAYS = 180
MIN_HISTORY = 5


# ------------------------------------------------------------------ configuration
def load_config(conn: Conn, now: datetime) -> S.Config:
    """Weights, bands and capacities from configuration; expected stage durations from the configured time
    limits, adjusted by the median of recently completed stages (when there are enough of them)."""
    if "intelligence_config" in conn.cache:
        return conn.cache["intelligence_config"]
    rows = conn.all(
        """SELECT 'w' AS kind, code AS key, weight::float AS v, 0 AS n FROM risk_factors
           UNION ALL
           SELECT 'sla', st.code, r.days::float, 0 FROM stages st JOIN sla_rules r ON r.code = st.sla_code
           UNION ALL
           SELECT 'sla', 'reply', days::float, 0 FROM sla_rules WHERE code = 'deficiency_response'
           UNION ALL
           SELECT 'med', stage_code,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(0, (ist_date(completed_at) - ist_date(started_at))
                                                                       - paused_seconds / 86400.0)), count(*)
           FROM application_stages WHERE status = 'completed' AND completed_at > %(since)s AND completed_at <= %(now)s
           GROUP BY stage_code
           UNION ALL
           SELECT 'med', 'reply', percentile_cont(0.5) WITHIN GROUP (ORDER BY ist_date(responded_at) - ist_date(raised_at)),
                  count(*)
           FROM deficiencies WHERE status = 'responded' AND responded_at > %(since)s AND responded_at <= %(now)s
           HAVING count(*) > 0""",
        {"since": now - timedelta(days=HISTORY_WINDOW_DAYS), "now": now},
    )
    weights = {r["key"]: int(r["v"]) for r in rows if r["kind"] == "w"}
    sla = {r["key"]: int(r["v"]) for r in rows if r["kind"] == "sla"}
    med = {r["key"]: (r["v"], r["n"]) for r in rows if r["kind"] == "med"}

    def expected(key: str) -> int:
        base = sla.get(key, 0)
        m, n = med.get(key, (None, 0))
        return int(round((base + m) / 2)) if m is not None and n >= MIN_HISTORY else base

    reply_sla = sla.pop("reply", 15)
    cfg = S.Config(
        weights=weights, band_medium=int(setting(conn, "risk_band_medium")), band_high=int(setting(conn, "risk_band_high")),
        capacity=int(setting(conn, "reviewer_capacity")), committee_capacity=int(setting(conn, "committee_capacity")),
        stage_sla=sla, expected={k: expected(k) for k in sla}, reply_expected=expected("reply") if "reply" in med else reply_sla,
        reply_sla=reply_sla, snooze_days=int(setting(conn, "recommendation_snooze_days")),
    )
    conn.cache["intelligence_config"] = cfg
    return cfg


def intervention_rules(conn: Conn) -> list[dict]:
    return conn.all("""SELECT id, code, label, trigger_text, action, action_text, authorized_by, threshold,
                              threshold_label, est_days_saved, active, version FROM intervention_rules ORDER BY id""")


# ------------------------------------------------------------------ inputs
INPUTS_SQL = """
SELECT a.id, a.ref_no, a.institution_id, i.name AS institution, a.region_id, r.name AS region, a.route_snapshot,
       a.submitted_at, s.seq, s.stage_code, st.name AS stage_name, s.substatus, s.started_at, s.due_at, s.paused_at,
       s.paused_seconds, s.assigned_to, u.name AS assignee,
       (SELECT COALESCE(sum(x.paused_seconds), 0) FROM application_stages x WHERE x.application_id = a.id) AS paused_total,
       (SELECT count(*) FROM application_stages x WHERE x.status = 'active' AND x.assigned_to = s.assigned_to) AS assignee_load,
       (SELECT count(*) FROM deficiencies x WHERE x.application_id = a.id)
         + (SELECT count(*) FROM application_stages x WHERE x.application_id = a.id AND x.status = 'reverted') AS returns,
       d.raised_at AS deficiency_raised_at, d.response_due_at, v.id AS visit_id, v.status AS visit_status,
       CASE WHEN s.stage_code = 'evc' THEN (
              SELECT max(n) FROM (SELECT count(*) AS n FROM evc_members m2 JOIN evc_visits v2 ON v2.id = m2.visit_id
                                  WHERE v2.status NOT IN ('reviewed', 'cancelled')
                                    AND m2.user_id IN (SELECT m.user_id FROM evc_members m WHERE m.visit_id = v.id)
                                  GROUP BY m2.user_id) q)
            WHEN s.stage_code = 'sac' THEN (
              SELECT max(n) FROM (SELECT count(*) AS n FROM committee_members m2 JOIN committee_reviews r2 ON r2.id = m2.review_id
                                  WHERE r2.status = 'pending'
                                    AND m2.user_id IN (SELECT cm.user_id FROM committee_members cm
                                                       JOIN committee_reviews cr ON cr.id = cm.review_id
                                                       WHERE cr.stage_id = s.id AND cr.status = 'pending')
                                  GROUP BY m2.user_id) q)
       END AS committee_load,
       doc.id AS doc_id, doc.title AS doc_title, doc.expires_on AS doc_expires,
       (SELECT max(e.level) FROM escalations e JOIN alerts al ON al.id = e.alert_id
         WHERE e.status = 'open' AND al.application_id = a.id
           AND al.entity_type IN ('stage', 'deficiency', 'evc_step')) AS escalation_level
FROM applications a
JOIN institutions i ON i.id = a.institution_id JOIN regions r ON r.id = a.region_id
JOIN application_stages s ON s.id = a.current_stage_id JOIN stages st ON st.code = s.stage_code
LEFT JOIN users u ON u.id = s.assigned_to
LEFT JOIN deficiencies d ON d.stage_id = s.id AND d.status = 'open'
LEFT JOIN evc_visits v ON v.stage_id = s.id AND v.status <> 'cancelled'
LEFT JOIN LATERAL (SELECT t.id, t.title, t.expires_on FROM tracked_documents t
                   WHERE t.institution_id = a.institution_id AND t.status IN ('valid', 'renewal_rejected')
                   ORDER BY t.expires_on, t.id LIMIT 1) doc ON true
WHERE a.status = 'in_progress'
  AND (%(ids)s::int[] IS NULL OR a.id = ANY(%(ids)s::int[]))
  AND (%(region)s::int IS NULL OR a.region_id = %(region)s)
ORDER BY a.id
"""


def load_inputs(conn: Conn, now: datetime, app_ids: list[int] | None = None,
                region_id: int | None = None) -> list[S.CaseInputs]:
    today = ist_date(now)
    out = []
    for r in conn.all(INPUTS_SQL, {"ids": app_ids, "region": region_id}):
        open_pause = int((now - r["paused_at"]).total_seconds()) if r["paused_at"] else 0
        stage_pause_days = round((r["paused_seconds"] + open_pause) / 86400)
        out.append(S.CaseInputs(
            app_id=r["id"], ref_no=r["ref_no"], institution_id=r["institution_id"], institution=r["institution"],
            region_id=r["region_id"], region=r["region"], route=tuple(r["route_snapshot"]), seq=r["seq"],
            stage_code=r["stage_code"], stage_name=r["stage_name"], substatus=r["substatus"],
            submitted=ist_date(r["submitted_at"]), today=today,
            institution_days=round((r["paused_total"] + open_pause) / 86400),
            stage_days=max(0, (today - ist_date(r["started_at"])).days - stage_pause_days),
            stage_due=ist_date(r["due_at"]) + timedelta(days=(today - ist_date(r["paused_at"])).days if r["paused_at"] else 0),
            assigned_to=r["assigned_to"], assignee=r["assignee"], assignee_load=r["assignee_load"] or 0,
            committee_load=r["committee_load"] or 0,
            open_deficiency_days=(today - ist_date(r["deficiency_raised_at"])).days if r["deficiency_raised_at"] else None,
            deficiency_due=ist_date(r["response_due_at"]) if r["response_due_at"] else None,
            returns=r["returns"], visit_id=r["visit_id"], visit_status=r["visit_status"], doc_id=r["doc_id"],
            doc_title=r["doc_title"], doc_expires=r["doc_expires"], escalation_level=r["escalation_level"],
        ))
    return out


def regional_officers(conn: Conn) -> list[dict]:
    """Regional officials with their current load (for the reassignment rule)."""
    return conn.all(
        """SELECT u.id, u.name, u.region_id, (u.rank >= 2) AS can_decide,
                  (SELECT count(*) FROM application_stages s WHERE s.status = 'active' AND s.assigned_to = u.id) AS load
           FROM users u WHERE u.role = 'official' AND u.official_kind = 'regional' ORDER BY u.id""")


def assess(conn: Conn, now: datetime, app_ids: list[int] | None = None,
           region_id: int | None = None) -> list[tuple[S.CaseInputs, S.Assessment]]:
    cfg = load_config(conn, now)
    return [(inp, S.assess(inp, cfg)) for inp in load_inputs(conn, now, app_ids, region_id)]


def _store(conn: Conn, now: datetime, pairs: list[tuple[S.CaseInputs, S.Assessment]]) -> None:
    today = ist_date(now)
    for inp, a in pairs:
        conn.defer(
            """INSERT INTO risk_assessments (application_id, assessed_on, assessed_at, score, band, factors,
                                             projected_completion, case_due, projected_delay, stage_code, region_id,
                                             assigned_to)
               VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (application_id, assessed_on) DO UPDATE SET
                 assessed_at = EXCLUDED.assessed_at, score = EXCLUDED.score, band = EXCLUDED.band,
                 factors = EXCLUDED.factors, projected_completion = EXCLUDED.projected_completion,
                 case_due = EXCLUDED.case_due, projected_delay = EXCLUDED.projected_delay,
                 stage_code = EXCLUDED.stage_code, region_id = EXCLUDED.region_id, assigned_to = EXCLUDED.assigned_to""",
            (a.app_id, today, now, a.score, a.band, json.dumps(a.factors, sort_keys=True), a.projected_completion,
             a.case_due, a.projected_delay, inp.stage_code, inp.region_id, inp.assigned_to),
        )


# ------------------------------------------------------------------ the tick
def on_tick(conn: Conn, now: datetime, only_if_missing: bool = False, light: bool = False) -> dict:
    """Assess, store, refresh recommendations and measure outcomes. Idempotent: the assessment is upserted
    per (case, day), at most one recommendation is open per case, and each outcome checkpoint is written once.
    `light` only measures the outcome checkpoints due today (used for the days a clock advance passes through)."""
    today = ist_date(now)
    if light:
        # the days that hold a day-7 checkpoint are read once per transaction (a clock advance is one)
        if "outcome_days" not in conn.cache:
            conn.cache["outcome_days"] = {r["d"] for r in conn.all(
                """SELECT ist_date(i.decided_at) + 7 AS d FROM interventions i WHERE i.status = 'approved'
                     AND NOT EXISTS (SELECT 1 FROM intervention_outcomes o WHERE o.intervention_id = i.id
                                       AND o.checkpoint = 'day7')""")}
        if today not in conn.cache["outcome_days"]:
            return {"assessed": 0, "measured": 0}
        return {"assessed": 0, "measured": measure_outcomes(conn, now, None)}
    if only_if_missing and conn.val("SELECT EXISTS (SELECT 1 FROM risk_assessments WHERE assessed_on = %s)", (today,)):
        return {"assessed": 0}
    pairs = assess(conn, now)
    _store(conn, now, pairs)
    rec = sync_recommendations(conn, now, pairs)
    measured = measure_outcomes(conn, now, {a.app_id: a for _, a in pairs})
    return {"assessed": len(pairs), **rec, "measured": measured}


def sync_recommendations(conn: Conn, now: datetime, pairs: list[tuple[S.CaseInputs, S.Assessment]]) -> dict:
    cfg = load_config(conn, now)
    rules = intervention_rules(conn)
    officers = regional_officers(conn)
    state = conn.all(
        """SELECT 'open' AS kind, id, application_id, rule_id, NULL::timestamptz AS at FROM interventions WHERE status = 'open'
           UNION ALL
           SELECT 'snoozed', NULL, application_id, rule_id, max(decided_at) FROM interventions
           WHERE status = 'dismissed' AND decided_at > %s GROUP BY application_id, rule_id""",
        (now - timedelta(days=cfg.snooze_days),))
    open_recs = {r["application_id"]: r for r in state if r["kind"] == "open"}
    snoozed = {(r["application_id"], r["rule_id"]) for r in state if r["kind"] == "snoozed"}
    created = withdrawn = 0
    seen = set()
    for inp, a in pairs:
        seen.add(a.app_id)
        matches = [m for m in S.match_rules(inp, a, rules, cfg, officers) if (a.app_id, m["rule"]["id"]) not in snoozed]
        best = matches[0] if matches else None
        current = open_recs.get(a.app_id)
        if current and best and current["rule_id"] == best["rule"]["id"]:
            continue
        if current:
            _withdraw(conn, now, current, "A different action now fits better." if best else "No longer needed.")
            withdrawn += 1
        if best:
            _recommend(conn, now, inp, a, best)
            created += 1
    for app_id, current in open_recs.items():
        if app_id not in seen:
            _withdraw(conn, now, current, "The case is decided.")
            withdrawn += 1
    return {"recommended": created, "withdrawn": withdrawn}


def _recommend(conn: Conn, now: datetime, inp: S.CaseInputs, a: S.Assessment, m: dict) -> int:
    r = m["rule"]
    iid = conn.val(
        """INSERT INTO interventions (application_id, rule_id, rule_version, action, status, reason, effect, params,
                                      created_at, score_before, band_before, delay_before, projected_before, case_due_before)
           VALUES (%s,%s,%s,%s,'open',%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (inp.app_id, r["id"], r["version"], r["action"], m["reason"], m["effect"], json.dumps(m["params"]), now,
         a.score, a.band, a.projected_delay, a.projected_completion, a.case_due))
    record(conn, at=now, actor=None, action="intervention.recommended", entity_type="intervention", entity_id=iid,
           application_id=inp.app_id,
           details={"rule": r["code"], "rule_version": r["version"], "action": r["action"], "score": a.score,
                    "band": a.band, "projected_delay": a.projected_delay, "reason": m["reason"]})
    return iid


def _withdraw(conn: Conn, now: datetime, rec: dict, why: str) -> None:
    conn.defer("UPDATE interventions SET status = 'withdrawn', decided_at = %s, decision_note = %s WHERE id = %s",
               (now, why, rec["id"]))
    record(conn, at=now, actor=None, action="intervention.withdrawn", entity_type="intervention", entity_id=rec["id"],
           application_id=rec["application_id"], details={"reason": why})


# ------------------------------------------------------------------ outcomes
def measure_outcomes(conn: Conn, now: datetime, current: dict[int, S.Assessment] | None) -> int:
    """Re-measure approved interventions: 7 simulated days after approval, and when the case is decided.
    With `current=None` the cases that need a day-7 measurement are assessed here (only those)."""
    today = ist_date(now)
    rows = conn.all(
        """SELECT i.id, i.application_id, i.decided_at, i.score_before, i.delay_before, i.case_due_before,
                  a.status AS app_status, a.decided_at AS app_decided_at,
                  (SELECT ra.case_due FROM risk_assessments ra WHERE ra.application_id = i.application_id
                    ORDER BY ra.assessed_on DESC LIMIT 1) AS last_case_due,
                  EXISTS (SELECT 1 FROM intervention_outcomes o WHERE o.intervention_id = i.id AND o.checkpoint = 'day7') AS has7,
                  EXISTS (SELECT 1 FROM intervention_outcomes o WHERE o.intervention_id = i.id
                            AND o.checkpoint = 'completion') AS hasc
           FROM interventions i JOIN applications a ON a.id = i.application_id
           WHERE i.status = 'approved'
             AND (NOT EXISTS (SELECT 1 FROM intervention_outcomes o WHERE o.intervention_id = i.id AND o.checkpoint = 'day7')
               OR NOT EXISTS (SELECT 1 FROM intervention_outcomes o WHERE o.intervention_id = i.id
                                AND o.checkpoint = 'completion'))""")
    if current is None:
        due7 = [r["application_id"] for r in rows if not r["has7"] and r["app_status"] == "in_progress"
                and today >= ist_date(r["decided_at"]) + timedelta(days=7)]
        current = {a.app_id: a for _, a in assess(conn, now, due7)} if due7 else {}
    written = 0
    for r in rows:
        decided = ist_date(r["app_decided_at"]) if r["app_decided_at"] else None
        due = r["last_case_due"] or r["case_due_before"]
        if not r["has7"] and today >= ist_date(r["decided_at"]) + timedelta(days=7):
            if r["app_status"] == "in_progress" and r["application_id"] in current:
                a = current[r["application_id"]]
                values = (a.score, a.projected_delay, a.score < r["score_before"], r["delay_before"] - a.projected_delay, None)
            elif decided is not None:
                actual = max(0, (decided - due).days)
                values = (None, actual, None, r["delay_before"] - actual, actual == 0)
            else:
                values = None
            if values:
                _outcome(conn, r["id"], "day7", today, *values)
                written += 1
        if not r["hasc"] and decided is not None:
            actual = max(0, (decided - due).days)
            _outcome(conn, r["id"], "completion", decided, None, actual, None, r["delay_before"] - actual, actual == 0)
            written += 1
    return written


def _outcome(conn: Conn, iid: int, checkpoint: str, on: date, score_after, delay_after, dropped, saved, on_time) -> None:
    conn.defer(
        """INSERT INTO intervention_outcomes (intervention_id, checkpoint, measured_on, score_after, delay_after,
                                              risk_dropped, days_saved, on_time)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
        (iid, checkpoint, on, score_after, delay_after, dropped, saved, on_time))


# ------------------------------------------------------------------ approve / dismiss
def _intervention(conn: Conn, iid: int) -> dict:
    row = conn.one(
        """SELECT i.*, r.code AS rule_code, r.label AS rule_label, r.authorized_by, a.region_id, a.ref_no,
                  a.institution_id, a.status AS app_status, inst.name AS institution_name
           FROM interventions i JOIN intervention_rules r ON r.id = i.rule_id
           JOIN applications a ON a.id = i.application_id JOIN institutions inst ON inst.id = a.institution_id
           WHERE i.id = %s FOR UPDATE OF i""", (iid,))
    if row is None:
        raise NotFound("Recommendation not found.")
    return row


AUTH_TEXT = {"regional": "a Regional officer of this Region", "regional_or_bureau": "a Regional or Bureau officer",
             "bureau": "a Bureau officer"}


def approve(conn: Conn, now: datetime, user: dict, iid: int, note: str | None = None) -> dict:
    """A permitted official approves: the underlying action runs through the normal engine functions."""
    iv = _intervention(conn, iid)
    ensure(S.can_authorize(user, iv["authorized_by"], iv["region_id"]),
           f"Only {AUTH_TEXT[iv['authorized_by']]} can approve this recommendation.", NotAllowed)
    ensure(iv["status"] == "open", "This recommendation is no longer open.")
    ensure(iv["app_status"] == "in_progress", "The case is already decided.")
    result = _execute(conn, now, user, iv)
    conn.run("""UPDATE interventions SET status = 'approved', decided_by = %s, decided_at = %s, decision_note = %s,
                       result = %s::jsonb WHERE id = %s""",
             (user["id"], now, (note or "").strip() or None, json.dumps(result), iid))
    record(conn, at=now, actor=user, action="intervention.approved", entity_type="intervention", entity_id=iid,
           application_id=iv["application_id"],
           details={"rule": iv["rule_code"], "rule_version": iv["rule_version"], "action": iv["action"],
                    "score_before": iv["score_before"], "result": result, "note": (note or "").strip() or None})
    conn.cache.pop("intelligence_config", None)
    _store(conn, now, assess(conn, now, [iv["application_id"]]))
    return result


def dismiss(conn: Conn, now: datetime, user: dict, iid: int, reason: str) -> None:
    reason = require_text(reason, "Reason for dismissing")
    iv = _intervention(conn, iid)
    ensure(S.can_authorize(user, iv["authorized_by"], iv["region_id"]),
           f"Only {AUTH_TEXT[iv['authorized_by']]} can dismiss this recommendation.", NotAllowed)
    ensure(iv["status"] == "open", "This recommendation is no longer open.")
    conn.run("""UPDATE interventions SET status = 'dismissed', decided_by = %s, decided_at = %s, decision_note = %s
                WHERE id = %s""", (user["id"], now, reason, iid))
    record(conn, at=now, actor=user, action="intervention.dismissed", entity_type="intervention", entity_id=iid,
           application_id=iv["application_id"], details={"rule": iv["rule_code"], "reason": reason})


def _ctx(iv: dict, **extra) -> dict:
    return {"ref": iv["ref_no"], "institution": iv["institution_name"], **extra}


def _execute(conn: Conn, now: datetime, user: dict, iv: dict) -> dict:
    action, params, app_id = iv["action"], iv["params"] or {}, iv["application_id"]
    link = f"/applications/{app_id}"
    if action == "priority_reminder":
        d = conn.one("SELECT response_due_at FROM deficiencies WHERE application_id = %s AND status = 'open'", (app_id,))
        ensure(d is not None, "The institution has already replied.")
        n = notifications.notify(conn, now=now, user_ids=institution_users(conn, iv["institution_id"]),
                                 template_code="intervention.reminder",
                                 ctx=_ctx(iv, due_date=fmt_date(d["response_due_at"])), link=link, kind="reminder",
                                 sms=True)
        return {"done": f"Priority reminder sent to the institution ({n} recipient{'s' if n != 1 else ''})."}
    if action == "reassign":
        target = conn.one("SELECT id, name FROM users WHERE id = %s", (params.get("target_id"),))
        ensure(target is not None, "The suggested officer was not found.")
        workflow.reassign(conn, now, user, app_id, target["id"])
        return {"done": f"Reassigned to {target['name']}.", "to": target["id"]}
    if action == "propose_visit_slot":
        v = conn.one("SELECT * FROM evc_visits WHERE application_id = %s AND status <> 'cancelled' ORDER BY id DESC LIMIT 1",
                     (app_id,))
        ensure(v is not None, "There is no expert visit on this case.")
        if v["status"] == "assignment_pending":
            members = conn.all(
                """SELECT u.id, u.name, (SELECT count(*) FROM evc_members m JOIN evc_visits x ON x.id = m.visit_id
                                          WHERE m.user_id = u.id AND x.status NOT IN ('reviewed', 'cancelled')) AS load
                   FROM users u WHERE u.role = 'committee' AND u.committee_kind = 'EVC' ORDER BY load, u.id LIMIT 3""")
            ids = [m["id"] for m in members]
            scheduling.assign_members(conn, now, user, v["id"], ids, ids[0])
            return {"done": f"Assigned {', '.join(m['name'] for m in members)} (least loaded).", "visit_id": v["id"]}
        if v["status"] == "availability_pending":
            pending = [m["user_id"] for m in scheduling.members(conn, v["id"]) if m["availability"] == "pending"]
            n = notifications.notify(conn, now=now, user_ids=pending, template_code="intervention.availability",
                                     ctx=_ctx(iv), link=f"/visits/{v['id']}", kind="reminder", sms=True)
            return {"done": f"Reminded {n} member{'s' if n != 1 else ''} to confirm their dates.", "visit_id": v["id"]}
        if v["status"] == "date_pending":
            today = ist_date(now)
            options = [x for x in scheduling.common_dates(conn, v["id"]) if today < x <= today + timedelta(days=60)]
            ensure(bool(options), "No date works for every member yet.")
            scheduling.schedule_visit(conn, now, user, v["id"], options[0])
            return {"done": f"Visit fixed for {fmt_date(options[0])}, the earliest date all members can do.",
                    "visit_id": v["id"]}
        raise InvalidAction("The visit is already scheduled.")
    if action == "escalate":
        level = min(3, int(params.get("level") or 1))
        target_kind = conn.val("SELECT target FROM escalation_levels WHERE level = %s", (level,))
        target = {"region_director": lambda: region_director(conn, iv["region_id"]),
                  "bureau_officer": lambda: bureau_officer(conn),
                  "bureau_head": lambda: bureau_head(conn)}.get(target_kind, lambda: region_director(conn, iv["region_id"]))()
        ensure(target is not None, "No official is configured for that level.")
        stage = conn.one("""SELECT st.name FROM applications a JOIN application_stages s ON s.id = a.current_stage_id
                            JOIN stages st ON st.code = s.stage_code WHERE a.id = %s""", (app_id,))
        notifications.notify(conn, now=now, user_ids=[target["id"]], template_code="intervention.escalate",
                             ctx=_ctx(iv, stage=stage["name"], actor=user["name"]), link=link, kind="escalation",
                             sms=True)
        return {"done": f"Brought to L{level}: {target['name']}.", "level": level, "to": target["id"]}
    if action == "request_document":
        doc = conn.one("SELECT id, title, expires_on FROM tracked_documents WHERE id = %s", (params.get("doc_id"),))
        ensure(doc is not None, "The document was not found.")
        n = notifications.notify(conn, now=now, user_ids=institution_users(conn, iv["institution_id"]),
                                 template_code="intervention.document",
                                 ctx=_ctx(iv, item=doc["title"], due_date=fmt_date(doc["expires_on"])),
                                 link="/documents", kind="reminder", sms=True)
        return {"done": f"Asked the institution for the renewed {doc['title'].lower()} ({n} recipient"
                        f"{'s' if n != 1 else ''})."}
    raise InvalidAction("Unknown action.")


# ------------------------------------------------------------------ reads for pages
def _row(inp: S.CaseInputs, a: S.Assessment) -> dict:
    owner = inp.assignee
    if inp.stage_code == "sac" or (inp.stage_code == "evc" and inp.visit_status not in S.OFFICIAL_EVC_STEPS):
        owner = None  # committee work: the stage-and-Region group already describes it
    return {"app_id": a.app_id, "ref_no": inp.ref_no, "institution": inp.institution, "region": inp.region,
            "stage_code": inp.stage_code, "stage_name": inp.stage_name, "substatus": inp.substatus, "owner": owner,
            "score": a.score, "band": a.band, "projected_delay": a.projected_delay,
            "projected_completion": a.projected_completion, "case_due": a.case_due, "points": a.points}


def overview(conn: Conn, now: datetime, region_id: int | None) -> dict:
    """Dashboard block: band counts, the top open recommendations and where delay is building."""
    pairs = assess(conn, now, region_id=region_id)
    rows = [_row(i, a) for i, a in pairs]
    ids = [r["app_id"] for r in rows]
    recs = conn.all(
        """SELECT i.id, i.application_id, i.reason, i.action, r.label AS rule_label, r.action_text
           FROM interventions i JOIN intervention_rules r ON r.id = i.rule_id
           WHERE i.status = 'open' AND i.application_id = ANY(%s)""", (ids,)) if ids else []
    by_app = {r["app_id"]: r for r in rows}
    watch = sorted((dict(rec, **{k: by_app[rec["application_id"]][k] for k in
                                ("ref_no", "institution", "score", "band", "projected_delay", "stage_name")})
                    for rec in recs if rec["application_id"] in by_app),
                   key=lambda w: (w["band"] != "high", -w["score"], w["application_id"]))
    counts = {b: sum(r["band"] == b for r in rows) for b in ("high", "medium", "low")}
    return {"counts": counts, "needs_attention": watch[:5], "open_recommendations": len(watch),
            "bottlenecks": S.bottlenecks(rows), "cases": {r["app_id"]: {k: r[k] for k in
                                                                        ("score", "band", "projected_delay")} for r in rows}}


def institution_blockers(conn: Conn, now: datetime, institution_id: int) -> list[dict]:
    """Cases where the institution is what the case is waiting on and the case is at risk: a plain note for the
    institution home ("Your reply is needed to avoid delay"), with the reply deadline."""
    rows = conn.all("SELECT id FROM applications WHERE institution_id = %s AND status = 'in_progress'", (institution_id,))
    out = []
    for inp, a in assess(conn, now, [r["id"] for r in rows]) if rows else []:
        if inp.open_deficiency_days is not None and a.band != "low":
            out.append({"application_id": inp.app_id, "ref_no": inp.ref_no, "due_date": inp.deficiency_due,
                        "days_to_due": (inp.deficiency_due - inp.today).days if inp.deficiency_due else None,
                        "band": a.band})
    return out


def likely_delayed(conn: Conn, now: datetime, app_ids: list[int]) -> set[int]:
    """Applications at High risk among the given ones (for the committee's small tag)."""
    if not app_ids:
        return set()
    return {a.app_id for _, a in assess(conn, now, sorted(set(app_ids))) if a.band == "high"}


def case_risk(conn: Conn, now: datetime, app_id: int, user: dict) -> dict:
    """Case page panel: live assessment, reasons, waiting-time split, history, recommendation and outcomes."""
    pairs = assess(conn, now, [app_id])
    out: dict = {"assessment": None, "split": split(conn, now, app_id), "history": [], "recommendation": None,
                 "interventions": []}
    history = conn.all("""SELECT assessed_on, score, band, projected_delay FROM risk_assessments
                          WHERE application_id = %s ORDER BY assessed_on DESC LIMIT 30""", (app_id,))
    out["history"] = list(reversed(history))
    if pairs:
        inp, a = pairs[0]
        cfg = load_config(conn, now)
        out["assessment"] = {
            "score": a.score, "band": a.band, "projected_completion": a.projected_completion, "case_due": a.case_due,
            "projected_delay": a.projected_delay, "remaining_days": a.remaining_days, "allowed_days": a.allowed_days,
            "summary": a.summary, "reasons": a.reasons,
            "factors": [{"code": k, "label": S.FACTOR_LABELS[k], "value": a.factors[k], "weight": cfg.weights.get(k, 0),
                         "points": a.points[k],
                         "text": S.reason_text(k, inp, cfg, a.projected_completion, a.case_due, a.remaining_days)}
                        for k in S.FACTOR_ORDER],
            "bands": {"medium": cfg.band_medium, "high": cfg.band_high},
            "expected": {s: cfg.expected.get(s, 0) for s in inp.route},
        }
    rows = conn.all(
        """SELECT i.id, i.status, i.action, i.reason, i.effect, i.params, i.created_at, i.score_before, i.band_before,
                  i.delay_before, i.decided_at, i.decision_note, i.result, i.rule_version, r.code AS rule_code,
                  r.label AS rule_label, r.action_text, r.authorized_by, r.est_days_saved, u.name AS decided_by_name,
                  (SELECT json_agg(json_build_object('checkpoint', o.checkpoint, 'measured_on', o.measured_on,
                                                     'score_after', o.score_after, 'delay_after', o.delay_after,
                                                     'risk_dropped', o.risk_dropped, 'days_saved', o.days_saved,
                                                     'on_time', o.on_time) ORDER BY o.checkpoint DESC)
                     FROM intervention_outcomes o WHERE o.intervention_id = i.id) AS outcomes
           FROM interventions i JOIN intervention_rules r ON r.id = i.rule_id LEFT JOIN users u ON u.id = i.decided_by
           WHERE i.application_id = %s AND i.status <> 'withdrawn' ORDER BY i.id DESC""", (app_id,))
    a_row = conn.one("SELECT region_id FROM applications WHERE id = %s", (app_id,))
    for r in rows:
        r["can_act"] = r["status"] == "open" and S.can_authorize(user, r["authorized_by"], a_row["region_id"])
        r["authorized_text"] = AUTH_TEXT[r["authorized_by"]]
    out["recommendation"] = next((r for r in rows if r["status"] == "open"), None)
    out["interventions"] = [r for r in rows if r["status"] != "open"]
    return out


def split(conn: Conn, now: datetime, app_id: int) -> dict:
    """Who the case has been waiting on, in days and in percentages that add up to 100."""
    today = ist_date(now)
    stages = conn.all("""SELECT s.id, s.stage_code, s.status, s.started_at, s.completed_at, s.paused_at, s.paused_seconds
                         FROM application_stages s WHERE s.application_id = %s ORDER BY s.id""", (app_id,))
    visits = {v["stage_id"]: v for v in conn.all(
        "SELECT * FROM evc_visits WHERE application_id = %s AND status <> 'cancelled'", (app_id,))}
    app = conn.one("SELECT submitted_at, decided_at FROM applications WHERE id = %s", (app_id,))
    end_all = app["decided_at"] or now
    days = dict.fromkeys(S.SPLIT_ORDER, 0.0)

    def span(a, b) -> float:
        return max(0.0, ((b or now) - a).total_seconds() / 86400) if a else 0.0

    for s in stages:
        end = s["completed_at"] or now
        paused = (s["paused_seconds"] + (int((now - s["paused_at"]).total_seconds()) if s["paused_at"] else 0)) / 86400
        days["institution"] += paused
        work = max(0.0, span(s["started_at"], end) - paused)
        if s["stage_code"] == "sac":
            days["committee"] += work
        elif s["stage_code"] == "evc" and s["id"] in visits:
            v = visits[s["id"]]
            t_assigned, t_sched = v["assigned_at"], v["scheduled_at"]
            t_cond, t_rep = v["conducted_at"], v["report_submitted_at"]
            marks = [s["started_at"], t_assigned, t_sched, t_cond, t_rep, end]
            buckets = ["scheduling", "scheduling", "committee", "committee", "official"]
            prev = marks[0]
            for nxt, bucket in zip(marks[1:], buckets, strict=True):
                if nxt is None:
                    days[bucket] += span(prev, end)
                    break
                days[bucket] += span(prev, min(nxt, end))
                prev = nxt
        else:
            days["official"] += work
    total = span(app["submitted_at"], end_all)
    days["system"] = max(0.0, total - sum(days.values()))
    return {"days": {k: round(v, 1) for k, v in days.items()}, "percent": S.split_percent(days),
            "total_days": round(total), "as_of": (ist_date(app["decided_at"]) if app["decided_at"] else today)}


# ------------------------------------------------------------------ metrics (performance page)
def metrics(conn: Conn, now: datetime) -> dict:
    """Intelligence results: intervention success, days saved, and a back-test of the risk predictions on the
    stored history."""
    today = ist_date(now)
    iv = conn.one(
        """WITH last AS (
             SELECT i.id, COALESCE(c.days_saved, d.days_saved) AS saved,
                    COALESCE(c.on_time, d.risk_dropped) AS success,
                    (c.intervention_id IS NOT NULL OR d.intervention_id IS NOT NULL) AS measured
             FROM interventions i
             LEFT JOIN intervention_outcomes c ON c.intervention_id = i.id AND c.checkpoint = 'completion'
             LEFT JOIN intervention_outcomes d ON d.intervention_id = i.id AND d.checkpoint = 'day7'
             WHERE i.status = 'approved')
           SELECT (SELECT count(*) FROM interventions WHERE status = 'approved') AS approved,
                  (SELECT count(*) FROM interventions WHERE status = 'dismissed') AS dismissed,
                  (SELECT count(*) FROM interventions WHERE status = 'open') AS open,
                  (SELECT count(*) FROM last WHERE measured) AS measured,
                  (SELECT count(*) FROM last WHERE measured AND success) AS succeeded,
                  (SELECT avg(saved) FROM last WHERE measured) AS avg_saved""")
    # A stage is late when it finished after its due date, or is still open past it. Outcomes are known for decided
    # cases and for open cases that are already late; open cases still on time are left out (outcome unknown).
    bt = conn.all(
        """WITH c AS (
             SELECT a.id, a.status,
                    (SELECT min(ist_date(s.due_at)) FROM application_stages s
                      WHERE s.application_id = a.id AND s.paused_at IS NULL
                        AND ((s.status = 'completed' AND ist_date(s.completed_at) > ist_date(s.due_at))
                          OR (s.status = 'active' AND ist_date(s.due_at) < %(today)s))) AS first_late_due
             FROM applications a
             WHERE EXISTS (SELECT 1 FROM risk_assessments ra WHERE ra.application_id = a.id))
           SELECT c.id, c.first_late_due IS NOT NULL AS late,
                  EXISTS (SELECT 1 FROM risk_assessments ra WHERE ra.application_id = c.id AND ra.band = 'high'
                            AND (c.first_late_due IS NULL OR ra.assessed_on <= c.first_late_due)) AS predicted_high
           FROM c WHERE c.status = 'decided' OR c.first_late_due IS NOT NULL""", {"today": today})
    tp = sum(1 for r in bt if r["predicted_high"] and r["late"])
    fp = sum(1 for r in bt if r["predicted_high"] and not r["late"])
    fn = sum(1 for r in bt if not r["predicted_high"] and r["late"])
    tn = len(bt) - tp - fp - fn

    def pct(a: int, b: int) -> float | None:
        return round(100.0 * a / b, 1) if b else None

    return {
        "interventions": {"approved": iv["approved"], "dismissed": iv["dismissed"], "open": iv["open"],
                          "measured": iv["measured"], "succeeded": iv["succeeded"],
                          "success_rate": pct(iv["succeeded"], iv["measured"]),
                          "avg_days_saved": round(float(iv["avg_saved"]), 1) if iv["avg_saved"] is not None else None},
        "backtest": {"cases": len(bt), "late": tp + fn, "predicted_high": tp + fp, "true_positive": tp,
                     "false_positive": fp, "false_negative": fn, "true_negative": tn,
                     "accuracy": pct(tp + tn, len(bt)), "false_alert_rate": pct(fp, tp + fp),
                     "late_caught": pct(tp, tp + fn)},
        "note": "Back-test on the stored synthetic history: a case is late if a stage finished, or is still open, after "
                "its due date, and predicted late if it was assessed High on or before that date. Cases still on time "
                "are left out until their outcome is known. Interventions in the synthetic history were approved, and "
                "responded to, by scripted participants.",
    }
