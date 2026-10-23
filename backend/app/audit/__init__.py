"""Append-only, hash-chained audit log.

Each entry stores the hash of the previous entry, so changing or removing any past entry breaks
every hash after it. `record` must be called inside the same transaction as the state change it
describes. A database trigger also blocks UPDATE and DELETE on the table.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from db import Conn

GENESIS = "0" * 64
_CHAIN_LOCK = 26262  # advisory lock id that serialises appends to the chain


def _normalise(details: dict | None) -> dict:
    # Round-trip through JSON so what we hash is exactly what jsonb gives back later.
    return json.loads(json.dumps(details or {}, default=str, sort_keys=True))


def _payload(entry: dict) -> str:
    at: datetime = entry["at"]
    body = {
        "id": int(entry["id"]),
        "at": at.astimezone(UTC).isoformat(),
        "actor_id": entry["actor_id"],
        "actor_label": entry["actor_label"],
        "action": entry["action"],
        "entity_type": entry["entity_type"],
        "entity_id": str(entry["entity_id"]),
        "application_id": entry["application_id"],
        "details": entry["details"],
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_hash(prev_hash: str, entry: dict) -> str:
    return hashlib.sha256((prev_hash + "|" + _payload(entry)).encode("utf-8")).hexdigest()


def actor_label(actor: dict | None) -> str:
    if actor is None:
        return "System (Argus automation)"
    return f"{actor['name']} ({actor['designation']})"


def record(
    conn: Conn,
    *,
    at: datetime,
    actor: dict | None,
    action: str,
    entity_type: str,
    entity_id: Any,
    application_id: int | None = None,
    details: dict | None = None,
) -> int:
    conn.run("SELECT pg_advisory_xact_lock(%s)", (_CHAIN_LOCK,))
    prev = conn.val("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1") or GENESIS
    entry = {
        "id": conn.val("SELECT nextval('audit_log_id_seq')"),
        "at": at,
        "actor_id": actor["id"] if actor else None,
        "actor_label": actor_label(actor),
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "application_id": application_id,
        "details": _normalise(details),
    }
    entry["prev_hash"] = prev
    entry["hash"] = compute_hash(prev, entry)
    conn.run(
        """INSERT INTO audit_log (id, at, actor_id, actor_label, action, entity_type, entity_id,
                                  application_id, details, prev_hash, hash)
           VALUES (%(id)s, %(at)s, %(actor_id)s, %(actor_label)s, %(action)s, %(entity_type)s, %(entity_id)s,
                   %(application_id)s, %(details)s::jsonb, %(prev_hash)s, %(hash)s)""",
        {**entry, "details": json.dumps(entry["details"])},
    )
    return entry["id"]


def verify_chain(conn: Conn) -> dict:
    """Recompute every hash in order. Returns where the chain first breaks, if it does."""
    prev = GENESIS
    checked = 0
    with conn.raw.cursor(name="audit_verify") as cur:
        cur.itersize = 2000
        cur.execute(
            """SELECT id, at, actor_id, actor_label, action, entity_type, entity_id, application_id,
                      details, prev_hash, hash FROM audit_log ORDER BY id"""
        )
        for row in cur:
            checked += 1
            if row["prev_hash"] != prev:
                return {"valid": False, "checked": checked, "broken_at": row["id"],
                        "reason": "Entry does not point to the previous entry (an entry was removed or reordered)."}
            if compute_hash(prev, row) != row["hash"]:
                return {"valid": False, "checked": checked, "broken_at": row["id"],
                        "reason": "Entry contents do not match its hash (the entry was changed)."}
            prev = row["hash"]
    return {"valid": True, "checked": checked, "broken_at": None, "reason": None, "head": prev}
