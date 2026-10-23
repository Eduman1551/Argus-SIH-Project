"""Document storage: upload, versioning, SHA-256, size limit and permission-checked download.

v1 keeps file bytes in PostgreSQL (bytea), because serverless functions have no persistent disk.
The `store` / `load` functions are the storage interface; swapping in object storage later only
changes this module.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime

from app.audit import record
from app.common import Invalid, NotAllowed, NotFound, ensure
from db import Conn

MAX_BYTES = 2 * 1024 * 1024
ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "text/plain": ".txt",
}
ENTITY_TYPES = {"application", "deficiency", "undertaking", "tracked_document", "evc_visit"}


def _clean_name(name: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", (name or "file").strip())[:120]
    return name or "file"


def store(conn: Conn, now: datetime, actor: dict | None, *, entity_type: str, entity_id: int, slot: str,
          filename: str, content_type: str, data: bytes, institution_id: int | None,
          application_id: int | None) -> dict:
    ensure(entity_type in ENTITY_TYPES, "Unknown document type.", Invalid)
    ensure(len(data) > 0, "The file is empty.", Invalid)
    ensure(len(data) <= MAX_BYTES, "Files must be 2 MB or smaller.", Invalid)
    content_type = (content_type or "").split(";")[0].strip().lower()
    ensure(content_type in ALLOWED_TYPES, "Only PDF, PNG, JPEG and plain text files are accepted.", Invalid)
    digest = hashlib.sha256(data).hexdigest()
    version = (conn.val("SELECT max(version) FROM files WHERE entity_type = %s AND entity_id = %s AND slot = %s",
                        (entity_type, entity_id, slot)) or 0) + 1
    fid = conn.val(
        """INSERT INTO files (institution_id, application_id, entity_type, entity_id, slot, version, filename,
                              content_type, size_bytes, sha256, data, uploaded_by, uploaded_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (institution_id, application_id, entity_type, entity_id, slot, version, _clean_name(filename), content_type,
         len(data), digest, data, actor["id"] if actor else None, now),
    )
    record(conn, at=now, actor=actor, action="document.uploaded", entity_type="file", entity_id=fid,
           application_id=application_id,
           details={"for": f"{entity_type}:{entity_id}", "slot": slot, "version": version,
                    "filename": _clean_name(filename), "size_bytes": len(data), "sha256": digest})
    return {"id": fid, "version": version, "sha256": digest, "size_bytes": len(data)}


def can_read(conn: Conn, user: dict, f: dict) -> bool:
    if user["role"] == "official":
        return True
    if user["role"] == "institution":
        return f["institution_id"] is not None and f["institution_id"] == user["institution_id"]
    # committee: only files of applications they are assigned to
    if f["application_id"] is None:
        return False
    return bool(conn.val(
        """SELECT 1 FROM evc_members m JOIN evc_visits v ON v.id = m.visit_id
           WHERE m.user_id = %(u)s AND v.application_id = %(a)s
           UNION ALL
           SELECT 1 FROM committee_members m JOIN committee_reviews r ON r.id = m.review_id
           WHERE m.user_id = %(u)s AND r.application_id = %(a)s LIMIT 1""",
        {"u": user["id"], "a": f["application_id"]}))


def load(conn: Conn, user: dict, file_id: int) -> dict:
    f = conn.one("SELECT * FROM files WHERE id = %s", (file_id,))
    if f is None:
        raise NotFound("File not found.")
    if not can_read(conn, user, f):
        raise NotAllowed("You do not have access to this file.")
    return f


def list_for(conn: Conn, entity_type: str, entity_ids: list[int]) -> list[dict]:
    return conn.all(
        """SELECT f.id, f.entity_type, f.entity_id, f.slot, f.version, f.filename, f.content_type, f.size_bytes,
                  f.sha256, f.uploaded_at, u.name AS uploaded_by
           FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
           WHERE f.entity_type = %s AND f.entity_id = ANY(%s) ORDER BY f.slot, f.version DESC""",
        (entity_type, entity_ids),
    )


def tiny_pdf(title: str, lines: list[str]) -> bytes:
    """A minimal one-page PDF (used for synthetic seed documents)."""

    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    text = ["BT", "/F1 16 Tf", "60 780 Td", f"({esc(title)}) Tj", "/F1 11 Tf"]
    for line in lines:
        text += ["0 -20 Td", f"({esc(line)}) Tj"]
    text.append("ET")
    stream = "\n".join(text).encode("latin-1", "replace")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
