"""Compliance engine: undertakings (time-bound conditions) and tracked document validity.

Undertaking: open -> evidence_submitted -> verified (closed)
                              \\-> resubmission_requested -> evidence_submitted -> ...
Document:    valid -> renewal_submitted -> valid (new expiry date)
                              \\-> renewal_rejected -> renewal_submitted -> ...
Reminders, overdue alerts and escalations for both are produced by the alert tick.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app import notifications
from app.audit import record
from app.clock import ist_date
from app.common import (
    Invalid,
    NotAllowed,
    NotFound,
    ensure,
    fmt_date,
    institution_users,
    region_officers,
    require_text,
)
from app.rules import setting
from db import Conn

DOC_TYPES = {
    "land_lease": "Land lease deed",
    "fire_noc": "Fire safety NOC",
    "building_stability": "Building stability certificate",
    "affiliation": "University affiliation letter",
    "bank_guarantee": "Bank guarantee / FDR",
}


# ------------------------------------------------------------------ undertakings
def create_undertaking(conn: Conn, now: datetime, actor: dict | None, app: dict, condition: str,
                       due_at: datetime) -> int:
    uid = conn.val(
        """INSERT INTO undertakings (application_id, institution_id, condition_text, due_at, status, created_at, created_by)
           VALUES (%s,%s,%s,%s,'open',%s,%s) RETURNING id""",
        (app["id"], app["institution_id"], condition, due_at, now, actor["id"] if actor else None),
    )
    record(conn, at=now, actor=actor, action="undertaking.created", entity_type="undertaking", entity_id=uid,
           application_id=app["id"], details={"condition": condition, "due_date": ist_date(due_at).isoformat()})
    return uid


def _undertaking(conn: Conn, uid: int) -> dict:
    u = conn.one("""SELECT u.*, i.name AS institution_name, i.region_id FROM undertakings u
                    JOIN institutions i ON i.id = u.institution_id WHERE u.id = %s FOR UPDATE OF u""", (uid,))
    if u is None:
        raise NotFound("Undertaking not found.")
    return u


def submit_evidence(conn: Conn, now: datetime, actor: dict, undertaking_id: int, file_id: int | None,
                    note: str) -> int:
    u = _undertaking(conn, undertaking_id)
    ensure(actor["role"] == "institution" and actor["institution_id"] == u["institution_id"],
           "Only the institution that gave the undertaking can submit evidence.", NotAllowed)
    ensure(u["status"] in ("open", "resubmission_requested"), "Evidence is already submitted or the undertaking is closed.")
    if file_id is not None:
        f = conn.one("SELECT entity_type, entity_id FROM files WHERE id = %s", (file_id,))
        ensure(f is not None and f["entity_type"] == "undertaking" and f["entity_id"] == undertaking_id,
               "The uploaded file does not belong to this undertaking.", Invalid)
    else:
        require_text(note, "A note describing the evidence (or a file)", 10)
    sid = conn.val("""INSERT INTO evidence_submissions (undertaking_id, file_id, note, submitted_by, submitted_at)
                      VALUES (%s,%s,%s,%s,%s) RETURNING id""",
                   (undertaking_id, file_id, (note or "").strip(), actor["id"], now))
    conn.run("UPDATE undertakings SET status = 'evidence_submitted' WHERE id = %s", (undertaking_id,))
    record(conn, at=now, actor=actor, action="undertaking.evidence_submitted", entity_type="undertaking",
           entity_id=undertaking_id, application_id=u["application_id"],
           details={"submission_id": sid, "file_id": file_id,
                    "late": ist_date(now) > ist_date(u["due_at"])})
    notifications.notify(conn, now=now, user_ids=[o["id"] for o in region_officers(conn, u["region_id"])],
                         template_code="event.evidence_submitted", ctx={"institution": u["institution_name"]},
                         link="/compliance", kind="task")
    return sid


def review_evidence(conn: Conn, now: datetime, actor: dict, undertaking_id: int, accept: bool,
                    remarks: str | None) -> None:
    ensure(actor["role"] == "official", "Only officials verify evidence.", NotAllowed)
    u = _undertaking(conn, undertaking_id)
    ensure(u["status"] == "evidence_submitted", "There is no evidence waiting for verification.")
    sub = conn.one("""SELECT id FROM evidence_submissions WHERE undertaking_id = %s AND review_status = 'pending'
                      ORDER BY id DESC LIMIT 1 FOR UPDATE""", (undertaking_id,))
    if not accept:
        remarks = require_text(remarks, "Reason for asking to resubmit")
    conn.run("""UPDATE evidence_submissions SET review_status = %s, reviewed_by = %s, reviewed_at = %s,
                       review_remarks = %s WHERE id = %s""",
             ("accepted" if accept else "resubmission_requested", actor["id"], now, (remarks or "").strip() or None,
              sub["id"]))
    if accept:
        conn.run("UPDATE undertakings SET status = 'verified', closed_at = %s, closed_by = %s WHERE id = %s",
                 (now, actor["id"], undertaking_id))
    else:
        conn.run("UPDATE undertakings SET status = 'resubmission_requested' WHERE id = %s", (undertaking_id,))
    record(conn, at=now, actor=actor,
           action="undertaking.verified" if accept else "undertaking.resubmission_requested",
           entity_type="undertaking", entity_id=undertaking_id, application_id=u["application_id"],
           details={"submission_id": sub["id"], "remarks": remarks, "closed": accept})
    notifications.notify(conn, now=now, user_ids=institution_users(conn, u["institution_id"]),
                         template_code="event.evidence_reviewed",
                         ctx={"outcome": "accepted and the undertaking is closed" if accept else "returned for resubmission",
                              "reason": remarks or ""},
                         link="/undertakings", kind="update")


def undertaking_state(u: dict, today: date, due_soon: int) -> str:
    if u["status"] == "verified":
        return "closed"
    if u["status"] == "evidence_submitted":
        return "awaiting_verification"
    days = (ist_date(u["due_at"]) - today).days
    if days < 0:
        return "overdue"
    if days <= due_soon:
        return "due_soon"
    return "open"


# ------------------------------------------------------------------ document validity
def _doc(conn: Conn, doc_id: int) -> dict:
    d = conn.one("""SELECT t.*, i.name AS institution_name, i.region_id FROM tracked_documents t
                    JOIN institutions i ON i.id = t.institution_id WHERE t.id = %s FOR UPDATE OF t""", (doc_id,))
    if d is None:
        raise NotFound("Document not found.")
    return d


def submit_renewal(conn: Conn, now: datetime, actor: dict, doc_id: int, file_id: int, new_expiry: date) -> None:
    d = _doc(conn, doc_id)
    ensure(actor["role"] == "institution" and actor["institution_id"] == d["institution_id"],
           "Only the institution that owns this document can upload a renewal.", NotAllowed)
    ensure(d["status"] in ("valid", "renewal_rejected"), "A renewal is already waiting for verification.")
    new_expiry = date.fromisoformat(new_expiry) if isinstance(new_expiry, str) else new_expiry
    today = ist_date(now)
    ensure(new_expiry > max(today, d["expires_on"]), "The new expiry date must be after the current expiry date and today.",
           Invalid)
    ensure(new_expiry <= today + timedelta(days=3660), "The new expiry date must be within ten years.", Invalid)
    f = conn.one("SELECT entity_type, entity_id FROM files WHERE id = %s", (file_id,))
    ensure(f is not None and f["entity_type"] == "tracked_document" and f["entity_id"] == doc_id,
           "Upload the renewed document first.", Invalid)
    conn.run("""UPDATE tracked_documents SET status = 'renewal_submitted', renewal_file_id = %s,
                       renewal_expires_on = %s, renewal_submitted_at = %s, remarks = NULL WHERE id = %s""",
             (file_id, new_expiry, now, doc_id))
    record(conn, at=now, actor=actor, action="document.renewal_submitted", entity_type="tracked_document",
           entity_id=doc_id, details={"file_id": file_id, "new_expiry": new_expiry.isoformat(),
                                      "current_expiry": d["expires_on"].isoformat()})
    notifications.notify(conn, now=now, user_ids=[o["id"] for o in region_officers(conn, d["region_id"])],
                         template_code="event.renewal_submitted",
                         ctx={"institution": d["institution_name"], "item": d["title"]}, link="/validity", kind="task")


def review_renewal(conn: Conn, now: datetime, actor: dict, doc_id: int, accept: bool, remarks: str | None) -> None:
    ensure(actor["role"] == "official", "Only officials verify renewals.", NotAllowed)
    d = _doc(conn, doc_id)
    ensure(d["status"] == "renewal_submitted", "There is no renewal waiting for verification.")
    if accept:
        conn.run("""UPDATE tracked_documents SET status = 'valid', valid_from = %s, expires_on = renewal_expires_on,
                           file_id = renewal_file_id, renewal_file_id = NULL, renewal_expires_on = NULL,
                           verified_at = %s, verified_by = %s, remarks = %s WHERE id = %s""",
                 (ist_date(now), now, actor["id"], (remarks or "").strip() or None, doc_id))
    else:
        remarks = require_text(remarks, "Reason for rejecting the renewal")
        conn.run("UPDATE tracked_documents SET status = 'renewal_rejected', remarks = %s, rejected_at = %s WHERE id = %s",
                 (remarks, now, doc_id))
    record(conn, at=now, actor=actor, action="document.renewal_verified" if accept else "document.renewal_rejected",
           entity_type="tracked_document", entity_id=doc_id,
           details={"remarks": remarks, "new_expiry": d["renewal_expires_on"].isoformat() if accept else None})
    notifications.notify(conn, now=now, user_ids=institution_users(conn, d["institution_id"]),
                         template_code="event.renewal_reviewed",
                         ctx={"item": d["title"], "outcome": "verified" if accept else "not accepted",
                              "reason": remarks or (f"Valid until {fmt_date(d['renewal_expires_on'])}." if accept else "")},
                         link="/documents", kind="update")


def document_state(d: dict, today: date, expiring_soon_days: int) -> str:
    """valid / expiring_soon / expired / renewal_submitted"""
    if d["status"] == "renewal_submitted":
        return "renewal_submitted"
    if d["expires_on"] < today:
        return "expired"
    if (d["expires_on"] - today).days <= expiring_soon_days:
        return "expiring_soon"
    return "valid"


def expiring_soon_days(conn: Conn) -> int:
    return int(setting(conn, "expiring_soon_days"))
