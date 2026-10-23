"""Demo identity and scoped authorization.

v1 uses a demo session: pick a seeded user and the server sets a signed cookie. This is NOT real
login (that is future scope), but every route still enforces scope on the server:
- institutions see only their own applications, undertakings, documents and files
- committee members see only the visits and reviews they are assigned to
- only Bureau officers edit rules
"""

from __future__ import annotations

import hashlib
import hmac

from app.common import NotAllowed, NotFound, is_bureau
from app.config import get_settings
from db import Conn

COOKIE = "argus_session"


class NotSignedIn(Exception):
    pass


def sign(user_id: int) -> str:
    mac = hmac.new(get_settings().session_secret.encode(), f"user:{user_id}".encode(), hashlib.sha256).hexdigest()
    return f"{user_id}.{mac[:32]}"


def unsign(token: str | None) -> int | None:
    if not token or "." not in token:
        return None
    uid, mac = token.split(".", 1)
    if not uid.isdigit():
        return None
    return int(uid) if hmac.compare_digest(sign(int(uid)), token) else None


def load_user(conn: Conn, token: str | None) -> dict:
    uid = unsign(token)
    if uid is None:
        raise NotSignedIn()
    user = conn.one(
        """SELECT u.*, i.name AS institution_name, r.name AS region_name FROM users u
           LEFT JOIN institutions i ON i.id = u.institution_id LEFT JOIN regions r ON r.id = u.region_id
           WHERE u.id = %s""", (uid,))
    if user is None:
        raise NotSignedIn()
    return user


def public_user(u: dict) -> dict:
    return {
        "id": u["id"], "code": u["code"], "name": u["name"], "role": u["role"], "designation": u["designation"],
        "official_kind": u["official_kind"], "rank": u["rank"], "committee_kind": u["committee_kind"],
        "region_id": u["region_id"], "region_name": u.get("region_name"), "institution_id": u["institution_id"],
        "institution_name": u.get("institution_name"), "is_bureau": is_bureau(u),
        "can_decide": u["role"] == "official" and (u["rank"] or 0) >= 2,
    }


# ------------------------------------------------------------------ scope checks
def require_role(user: dict, *roles: str) -> None:
    if user["role"] not in roles:
        raise NotAllowed("This page is not available for your role.")


def require_bureau(user: dict) -> None:
    if not is_bureau(user):
        raise NotAllowed("Only Bureau officers can change rules.")


def can_view_application(conn: Conn, user: dict, app_id: int) -> bool:
    if user["role"] == "official":
        return True
    if user["role"] == "institution":
        return bool(conn.val("SELECT 1 FROM applications WHERE id = %s AND institution_id = %s",
                             (app_id, user["institution_id"])))
    return bool(conn.val(
        """SELECT 1 FROM evc_members m JOIN evc_visits v ON v.id = m.visit_id
           WHERE m.user_id = %(u)s AND v.application_id = %(a)s AND v.status <> 'cancelled'
           UNION ALL
           SELECT 1 FROM committee_members m JOIN committee_reviews r ON r.id = m.review_id
           WHERE m.user_id = %(u)s AND r.application_id = %(a)s AND r.status <> 'cancelled' LIMIT 1""",
        {"u": user["id"], "a": app_id}))


def ensure_application(conn: Conn, user: dict, app_id: int) -> None:
    if not conn.val("SELECT 1 FROM applications WHERE id = %s", (app_id,)):
        raise NotFound("Application not found.")
    if not can_view_application(conn, user, app_id):
        # Same message as not found would leak less, but a clear message helps the demo.
        raise NotAllowed("You do not have access to this application.")


def entity_scope(conn: Conn, entity_type: str, entity_id: int) -> tuple[int | None, int | None]:
    """(institution_id, application_id) that owns an entity, for upload permission checks."""
    if entity_type == "application":
        r = conn.one("SELECT institution_id, id FROM applications WHERE id = %s", (entity_id,))
    elif entity_type == "deficiency":
        r = conn.one("""SELECT a.institution_id, a.id FROM deficiencies d JOIN applications a ON a.id = d.application_id
                        WHERE d.id = %s""", (entity_id,))
    elif entity_type == "undertaking":
        r = conn.one("SELECT institution_id, application_id AS id FROM undertakings WHERE id = %s", (entity_id,))
    elif entity_type == "tracked_document":
        r = conn.one("SELECT institution_id, NULL::int AS id FROM tracked_documents WHERE id = %s", (entity_id,))
    elif entity_type == "evc_visit":
        r = conn.one("""SELECT a.institution_id, a.id FROM evc_visits v JOIN applications a ON a.id = v.application_id
                        WHERE v.id = %s""", (entity_id,))
    else:
        r = None
    if r is None:
        raise NotFound("The item for this file was not found.")
    return r["institution_id"], r["id"]


def can_upload(conn: Conn, user: dict, entity_type: str, entity_id: int) -> tuple[int | None, int | None]:
    inst_id, app_id = entity_scope(conn, entity_type, entity_id)
    if user["role"] == "institution":
        if inst_id != user["institution_id"] or entity_type == "evc_visit":
            raise NotAllowed("You can upload files only for your own institution's items.")
    elif user["role"] == "committee":
        from app.scheduling import is_member

        if entity_type != "evc_visit" or not is_member(conn, entity_id, user["id"]):
            raise NotAllowed("Committee members can upload only visit reports for their own visits.")
    elif entity_type not in ("application", "evc_visit"):
        raise NotAllowed("Officials do not upload institution evidence.")
    return inst_id, app_id
