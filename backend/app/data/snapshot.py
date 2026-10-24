"""Dataset dump/load and the seeded snapshot used by the demo Reset button.

- `export_dump` writes every table to data/seed.copy.gz (PostgreSQL COPY text format).
- `load_dump` loads that file into an empty schema with one COPY per table, which is quick even on
  a remote serverless database.
- `save` copies all tables into the `snapshot` schema; `restore` puts them back in one round trip.
"""

from __future__ import annotations

import gzip
from pathlib import Path

from app.config import REPO_ROOT
from db import Conn

DUMP_PATH = REPO_ROOT / "data" / "seed.copy.gz"

# Insert order respects foreign keys (applications.current_stage_id is deferred).
TABLES = [
    "platform_clock", "regions", "institutions", "users", "sla_rules", "stages", "routes", "route_stages",
    "application_types", "reminder_rules", "escalation_levels", "escalation_rules", "notification_templates",
    "settings", "files", "applications", "application_stages", "deficiencies", "evc_visits", "evc_members",
    "visit_reports", "committee_reviews", "committee_members", "undertakings", "evidence_submissions",
    "tracked_documents", "alerts", "escalations", "notifications", "outbox", "risk_factors", "intervention_rules",
    "risk_assessments", "interventions", "intervention_outcomes", "audit_log",
]
NO_SERIAL = {"platform_clock", "sla_rules", "stages", "routes", "route_stages", "application_types",
             "escalation_levels", "notification_templates", "settings", "evc_members", "committee_members",
             "risk_factors", "intervention_outcomes", "audit_log"}
SEPARATOR = "\\.argus-table "


def _reset_sequences_sql() -> list[str]:
    sql = [f"SELECT setval(pg_get_serial_sequence('public.{t}', 'id'), "
           f"COALESCE((SELECT max(id) FROM public.{t}), 1), (SELECT count(*) > 0 FROM public.{t}));"
           for t in TABLES if t not in NO_SERIAL]
    sql.append("SELECT setval('public.audit_log_id_seq', COALESCE((SELECT max(id) FROM public.audit_log), 1), true);")
    return sql


# ------------------------------------------------------------------ dump file
def export_dump(conn: Conn, path: Path = DUMP_PATH) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    conn.flush()
    # mtime=0 keeps the gzip bytes identical for identical data
    with open(path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as out:
        for t in TABLES:
            out.write(f"{SEPARATOR}{t}\n".encode())
            with conn.raw.cursor() as cur:
                with cur.copy(f"COPY (SELECT * FROM public.{t} ORDER BY 1) TO STDOUT") as copy:
                    for chunk in copy:
                        out.write(bytes(chunk))
                        total += len(chunk)
    return total


def load_dump(conn: Conn, path: Path = DUMP_PATH) -> None:
    """Load the dataset into freshly created (empty) tables."""
    data = gzip.decompress(path.read_bytes()).decode("utf-8")
    sections = data.split(SEPARATOR)[1:]
    conn.run("SET CONSTRAINTS applications_current_stage_fk DEFERRED")
    for section in sections:
        table, _, body = section.partition("\n")
        assert table in TABLES, f"unexpected table {table} in dump"
        with conn.raw.cursor() as cur:
            with cur.copy(f"COPY public.{table} FROM STDIN") as copy:
                copy.write(body)
    conn.script("\n".join(_reset_sequences_sql()))


# ------------------------------------------------------------------ snapshot for Reset
def save(conn: Conn) -> None:
    sql = ["DROP SCHEMA IF EXISTS snapshot CASCADE;", "CREATE SCHEMA snapshot;"]
    sql += [f"CREATE TABLE snapshot.{t} AS TABLE public.{t};" for t in TABLES]
    conn.script("\n".join(sql))


def has_snapshot(conn: Conn) -> bool:
    return bool(conn.val("SELECT to_regclass('snapshot.audit_log') IS NOT NULL"))


def restore(conn: Conn) -> None:
    if not has_snapshot(conn):
        raise RuntimeError("No seeded snapshot found. Run `pnpm db:seed` first.")
    sql = ["SET CONSTRAINTS applications_current_stage_fk DEFERRED;",
           f"TRUNCATE {', '.join('public.' + t for t in TABLES)};"]
    sql += [f"INSERT INTO public.{t} SELECT * FROM snapshot.{t};" for t in TABLES]
    sql += _reset_sequences_sql()
    conn.script("\n".join(sql))
