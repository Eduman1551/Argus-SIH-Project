"""Configurable rules: routes, SLA days, reminder offsets, escalation chain, templates, settings.

Everything here is read from database tables at the moment it is needed. Changing a rule on the
Rules page changes behaviour with no code change, and every change is written to the audit log.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from app.audit import record
from app.rules import defaults as D
from db import Conn


class RuleError(ValueError):
    pass


ENTITY_TYPES = list(D.ENTITY_LABELS)
ESCALATION_TARGETS = {
    "assigned_officer": "Officer handling the item",
    "region_director": "Regional Director of the Region",
    "bureau_officer": "Bureau Officer, Approval Bureau",
    "bureau_head": "Bureau Head",
}


# ------------------------------------------------------------------ seed
def seed_defaults(conn: Conn, effective_from: date) -> None:
    conn.many("INSERT INTO sla_rules (code, label, days, waits_on, description) VALUES (%s,%s,%s,%s,%s)", D.SLA_RULES)
    conn.many("INSERT INTO stages (code, name, actor, sla_code, sort, description) VALUES (%s,%s,%s,%s,%s,%s)", D.STAGES)
    for code, name, desc, stages in D.ROUTES:
        conn.run("INSERT INTO routes (code, name, description) VALUES (%s,%s,%s)", (code, name, desc))
        conn.many("INSERT INTO route_stages (route_code, seq, stage_code) VALUES (%s,%s,%s)",
                  [(code, i + 1, s) for i, s in enumerate(stages)])
    conn.many("INSERT INTO application_types (code, name, route_code) VALUES (%s,%s,%s)", D.APPLICATION_TYPES)
    rows = []
    for entity, (offsets, overdue) in D.REMINDERS.items():
        rows += [(entity, "reminder", o, f"reminder.{entity}", effective_from) for o in offsets]
        rows.append((entity, "overdue", overdue, f"overdue.{entity}", effective_from))
    conn.many("""INSERT INTO reminder_rules (entity_type, kind, offset_days, template_code, effective_from)
                 VALUES (%s,%s,%s,%s,%s)""", rows)
    conn.many("INSERT INTO escalation_levels (level, title, target) VALUES (%s,%s,%s)", D.ESCALATION_LEVELS)
    conn.many("INSERT INTO escalation_rules (entity_type, level, days_after_due, effective_from) VALUES (%s,%s,%s,%s)",
              [(e, i + 1, d, effective_from) for e, days in D.ESCALATIONS.items() for i, d in enumerate(days)])
    conn.many("INSERT INTO notification_templates (code, label, subject, body, sms) VALUES (%s,%s,%s,%s,%s)", D.TEMPLATES)
    conn.many("INSERT INTO settings (key, value, label, description) VALUES (%s,%s::jsonb,%s,%s)",
              [(k, json.dumps(v), label, desc) for k, v, label, desc in D.SETTINGS])


# ------------------------------------------------------------------ reads
def sla_days(conn: Conn, code: str) -> int:
    days = conn.val("SELECT days FROM sla_rules WHERE code = %s", (code,))
    if days is None:
        raise RuleError(f"Unknown SLA rule {code}")
    return int(days)


def stage_sla_days(conn: Conn, stage_code: str) -> int:
    return int(conn.val("SELECT r.days FROM stages s JOIN sla_rules r ON r.code = s.sla_code WHERE s.code = %s",
                        (stage_code,)))


def route_for_type(conn: Conn, app_type: str) -> tuple[str, list[str]]:
    row = conn.one("SELECT route_code FROM application_types WHERE code = %s", (app_type,))
    if row is None:
        raise RuleError(f"Unknown application type {app_type}")
    return row["route_code"], route_stage_codes(conn, row["route_code"])


def route_stage_codes(conn: Conn, route_code: str) -> list[str]:
    return [r["stage_code"] for r in conn.all(
        "SELECT stage_code FROM route_stages WHERE route_code = %s ORDER BY seq", (route_code,))]


# Settings and templates are read once per transaction; an update in the same transaction clears them.
def setting(conn: Conn, key: str) -> Any:
    if "settings" not in conn.cache:
        conn.cache["settings"] = {r["key"]: r["value"] for r in conn.all("SELECT key, value FROM settings")}
    if key not in conn.cache["settings"]:
        raise RuleError(f"Unknown setting {key}")
    return conn.cache["settings"][key]


def template(conn: Conn, code: str) -> dict:
    if "templates" not in conn.cache:
        conn.cache["templates"] = {r["code"]: r for r in conn.all(
            "SELECT code, subject, body, sms FROM notification_templates")}
    if code not in conn.cache["templates"]:
        raise RuleError(f"Unknown template {code}")
    return conn.cache["templates"][code]


def get_all(conn: Conn) -> dict:
    routes = conn.all("SELECT code, name, description FROM routes ORDER BY code")
    for r in routes:
        r["stages"] = route_stage_codes(conn, r["code"])
    return {
        "illustrative_notice": "These values are illustrative assumptions for the prototype, not official APH figures.",
        "sla": conn.all("SELECT code, label, days, waits_on, description FROM sla_rules ORDER BY code"),
        "stages": conn.all("SELECT code, name, actor, sla_code, description FROM stages ORDER BY sort"),
        "routes": routes,
        "application_types": conn.all("SELECT code, name, route_code FROM application_types ORDER BY name"),
        "reminders": conn.all("""SELECT id, entity_type, kind, offset_days, template_code, active, effective_from
                                 FROM reminder_rules ORDER BY entity_type, kind DESC, offset_days"""),
        "escalation_levels": conn.all("SELECT level, title, target FROM escalation_levels ORDER BY level"),
        "escalation_rules": conn.all("""SELECT id, entity_type, level, days_after_due, active
                                        FROM escalation_rules ORDER BY entity_type, level"""),
        "templates": conn.all("SELECT code, label, subject, body, sms FROM notification_templates ORDER BY code"),
        "settings": conn.all("SELECT key, value, label, description FROM settings ORDER BY key"),
        "entity_types": [{"code": k, "label": v} for k, v in D.ENTITY_LABELS.items()],
        "escalation_targets": [{"code": k, "label": v} for k, v in ESCALATION_TARGETS.items()],
    }


# ------------------------------------------------------------------ updates (all audited)
def _audit(conn: Conn, now, actor, what: str, key: str, before: Any, after: Any) -> None:
    conn.cache.pop("settings", None)
    conn.cache.pop("templates", None)
    record(conn, at=now, actor=actor, action="rule.changed", entity_type="rule", entity_id=f"{what}:{key}",
           details={"rule": what, "key": key, "before": before, "after": after})


def update_sla(conn: Conn, now, actor, code: str, days: int) -> None:
    if not 1 <= int(days) <= 365:
        raise RuleError("Days must be between 1 and 365.")
    before = conn.val("SELECT days FROM sla_rules WHERE code = %s FOR UPDATE", (code,))
    if before is None:
        raise RuleError(f"Unknown SLA rule {code}")
    conn.run("UPDATE sla_rules SET days = %s WHERE code = %s", (int(days), code))
    _audit(conn, now, actor, "sla", code, before, int(days))


def update_route(conn: Conn, now, actor, route_code: str, stages: list[str]) -> None:
    before = route_stage_codes(conn, route_code)
    if not before:
        raise RuleError(f"Unknown route {route_code}")
    known = {r["code"] for r in conn.all("SELECT code FROM stages")}
    if not stages or stages[0] != "intake" or stages[-1] != "decision":
        raise RuleError("A route must start with the completeness check and end with the decision.")
    if len(set(stages)) != len(stages) or any(s not in known for s in stages):
        raise RuleError("Each stage may appear once and must be a known stage.")
    conn.run("DELETE FROM route_stages WHERE route_code = %s", (route_code,))
    conn.many("INSERT INTO route_stages (route_code, seq, stage_code) VALUES (%s,%s,%s)",
              [(route_code, i + 1, s) for i, s in enumerate(stages)])
    _audit(conn, now, actor, "route", route_code, before, stages)


def update_application_type(conn: Conn, now, actor, app_type: str, route_code: str) -> None:
    before = conn.val("SELECT route_code FROM application_types WHERE code = %s", (app_type,))
    if before is None:
        raise RuleError(f"Unknown application type {app_type}")
    if not conn.val("SELECT 1 FROM routes WHERE code = %s", (route_code,)):
        raise RuleError(f"Unknown route {route_code}")
    conn.run("UPDATE application_types SET route_code = %s WHERE code = %s", (route_code, app_type))
    _audit(conn, now, actor, "application_type", app_type, before, route_code)


def update_reminder_offsets(conn: Conn, now, actor, entity_type: str, offsets: list[int], overdue: int) -> None:
    """Replace the active reminder offsets for an entity type. New offsets take effect from today,
    so they never fire for days already passed."""
    if entity_type not in D.ENTITY_LABELS:
        raise RuleError(f"Unknown item type {entity_type}")
    offsets = sorted({int(o) for o in offsets})
    if any(o > 0 or o < -180 for o in offsets):
        raise RuleError("Reminder offsets must be between -180 and 0 days (days before the due date).")
    if not 1 <= int(overdue) <= 30:
        raise RuleError("The overdue alert must be 1 to 30 days after the due date.")
    today = now.date()
    before = conn.all("""SELECT kind, offset_days FROM reminder_rules WHERE entity_type = %s AND active
                         ORDER BY kind, offset_days""", (entity_type,))
    wanted = [("reminder", o) for o in offsets] + [("overdue", int(overdue))]
    was_active = {(b["kind"], b["offset_days"]) for b in before}
    for kind, off in was_active - set(wanted):
        conn.run("UPDATE reminder_rules SET active = false WHERE entity_type = %s AND kind = %s AND offset_days = %s",
                 (entity_type, kind, off))
    # Offsets that stay keep their effective date; new or re-enabled ones start today.
    for kind, off in set(wanted) - was_active:
        conn.run(
            """INSERT INTO reminder_rules (entity_type, kind, offset_days, template_code, active, effective_from)
               VALUES (%s, %s, %s, %s, true, %s)
               ON CONFLICT (entity_type, kind, offset_days) DO UPDATE SET active = true, effective_from = EXCLUDED.effective_from""",
            (entity_type, kind, off, f"{kind}.{entity_type}", today),
        )
    _audit(conn, now, actor, "reminders", entity_type,
           [f"{b['kind']} {b['offset_days']:+d}" for b in before], [f"{k} {o:+d}" for k, o in wanted])


def update_escalation_days(conn: Conn, now, actor, entity_type: str, days: list[int]) -> None:
    if entity_type not in D.ENTITY_LABELS:
        raise RuleError(f"Unknown item type {entity_type}")
    days = [int(d) for d in days]
    if len(days) != 3 or any(d < 1 for d in days) or days != sorted(days) or len(set(days)) != 3:
        raise RuleError("Give three increasing day counts (L1 < L2 < L3), each at least 1.")
    before = [r["days_after_due"] for r in conn.all(
        "SELECT days_after_due FROM escalation_rules WHERE entity_type = %s ORDER BY level", (entity_type,))]
    for level, d in enumerate(days, start=1):
        conn.run("""UPDATE escalation_rules SET days_after_due = %s,
                        effective_from = CASE WHEN days_after_due = %s THEN effective_from ELSE %s END
                    WHERE entity_type = %s AND level = %s""", (d, d, now.date(), entity_type, level))
    _audit(conn, now, actor, "escalation_days", entity_type, before, days)


def update_escalation_level(conn: Conn, now, actor, level: int, title: str, target: str) -> None:
    if target not in ESCALATION_TARGETS:
        raise RuleError("Unknown escalation target.")
    if not title.strip():
        raise RuleError("Title is required.")
    before = conn.one("SELECT title, target FROM escalation_levels WHERE level = %s", (level,))
    if before is None:
        raise RuleError("Unknown level.")
    conn.run("UPDATE escalation_levels SET title = %s, target = %s WHERE level = %s", (title.strip(), target, level))
    _audit(conn, now, actor, "escalation_level", str(level), before, {"title": title.strip(), "target": target})


def update_template(conn: Conn, now, actor, code: str, subject: str, body: str, sms: str) -> None:
    before = conn.one("SELECT subject, body, sms FROM notification_templates WHERE code = %s", (code,))
    if before is None:
        raise RuleError("Unknown template.")
    if not subject.strip() or not body.strip() or not sms.strip():
        raise RuleError("Subject, body and SMS text are all required.")
    if len(sms) > 160:
        raise RuleError("SMS text must be 160 characters or fewer.")
    after = {"subject": subject.strip(), "body": body.strip(), "sms": sms.strip()}
    conn.run("UPDATE notification_templates SET subject = %(subject)s, body = %(body)s, sms = %(sms)s WHERE code = %(code)s",
             {**after, "code": code})
    _audit(conn, now, actor, "template", code, before, after)


def update_setting(conn: Conn, now, actor, key: str, value: Any) -> None:
    before = conn.one("SELECT value FROM settings WHERE key = %s", (key,))
    if before is None:
        raise RuleError("Unknown setting.")
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 365:
        raise RuleError("Value must be a whole number between 0 and 365.")
    conn.run("UPDATE settings SET value = %s::jsonb WHERE key = %s", (json.dumps(value), key))
    _audit(conn, now, actor, "setting", key, before["value"], value)
