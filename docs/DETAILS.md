# Argus: technical details

## Repository layout

| Path | What it holds |
|---|---|
| `backend/db/schema.sql`, `backend/db/__init__.py` | PostgreSQL schema and a small psycopg 3 helper (plain SQL, one transaction per request, a thread-free cache of idle connections) |
| `backend/app/clock` | simulated platform clock: `now(conn)`, `advance(days)` one day at a time |
| `backend/app/rules` | configuration tables: routes, SLA days, reminder offsets, escalation chain, templates, settings; validated and audited updates |
| `backend/app/workflow` | state machine, routing, assignment by workload, deficiency loop with SLA pause, revert, SAC/SHC committee, decision recording, case facts |
| `backend/app/scheduling` | EVC visit steps and the scheduling board |
| `backend/app/compliance` | undertakings, evidence, verification, tracked document validity and renewals |
| `backend/app/alerts` | the idempotent alert tick and escalation engine |
| `backend/app/notifications` | in-app notifications, template rendering, simulated email/SMS outbox |
| `backend/app/documents` | file storage in `bytea`, versions, SHA-256, 2 MB limit, permission-checked download |
| `backend/app/audit` | append-only hash-chained audit log and verification |
| `backend/app/auth` | demo session cookie (HMAC-signed) and scope checks |
| `backend/app/reports`, `backend/app/kpi` | pendency computations shared by dashboards and reports, CSV, KPIs, routing self-test |
| `backend/app/llm` | optional Groq drafting with offline templates |
| `backend/app/api` | FastAPI routes, dashboards, case page payload |
| `backend/app/data` | synthetic data generator, dataset dump/load, Reset snapshot, guided demo steps |
| `data/seed.copy.gz` | the generated dataset (PostgreSQL COPY format), loaded by `pnpm db:seed` |
| `frontend/` | Next.js App Router portal |
| `scripts/` | Windows-friendly `.mjs` and Python helpers (setup, local Postgres, db, smoke, e2e, screenshots) |

## Data model (main tables)

- **Configuration**: `sla_rules`, `stages`, `routes` + `route_stages`, `application_types`, `reminder_rules`,
  `escalation_levels`, `escalation_rules`, `notification_templates`, `settings`.
- **Workflow**: `applications` (with `route_snapshot`, the stage list fixed at submission),
  `application_stages` (one row per attempt, `paused_at` / `paused_seconds` for the SLA pause),
  `deficiencies`, `committee_reviews` + `committee_members`.
- **Scheduling**: `evc_visits`, `evc_members` (availability and offered dates), `visit_reports`.
- **Compliance**: `undertakings`, `evidence_submissions`, `tracked_documents`.
- **Alerts**: `alerts` (unique `alert_key`), `escalations`, `notifications`, `outbox`.
- **Records**: `files`, `audit_log`, `platform_clock`.

## Workflow rules

- An application's route is copied into `route_snapshot` when it is submitted, so later rule changes never
  re-route cases already in flight.
- Completeness check and scrutiny: `in_review` → (deficiency) `awaiting_institution` → `re_review` →
  completed. Raising a deficiency needs a reason of at least 10 characters and pauses the AICTE SLA clock;
  the reply resumes it and extends the stage due date by exactly the paused time.
- Completing a stage routes the case to the next stage of its route automatically and assigns it: review
  stages by workload (fewest active stages in the Region), decision to the Regional Director, SAC/SHC to
  the two least-loaded SAC members.
- EVC: assignment → availability → date → visit → report → review. Each step has its own limit
  (`evc_*` SLA rules); the visit step is due on the visit date itself.
- Revert sends a case at EVC, SAC/SHC or decision back to an earlier completeness check or scrutiny stage
  with a reason; open visits and reviews for that stage are cancelled.
- Decisions: only an official of rank 2 or above (Regional Director, Bureau) can record one, with a reason.
  "Approved with undertakings" creates one undertaking per condition. Illegal transitions return HTTP 409.

## The alert tick

`run_alert_tick(conn, now)` (in `backend/app/alerts`):

1. Takes an advisory lock so two ticks never overlap.
2. Moves simulated delivery one step (`sent → delivered/failed`, then `queued → sent`).
3. Builds the list of open tracked items in SQL: active non-EVC stages (not while paused), open deficiency
   replies, EVC steps, open undertakings, valid or rejected documents. Each has a due date, a start date
   and a cycle (for example a document's expiry date, so a renewed document starts a fresh cycle).
4. **Reminders** fire only on their exact day (`due + offset = today`) and only if the item and the rule
   already existed that day. **Overdue alerts** and **escalations** catch up if needed, and store the day
   they should have fired.
5. Inserts each alert with `ON CONFLICT (alert_key) DO NOTHING`; only rows really inserted create
   notifications, outbox rows, escalation rows and audit entries. Running the tick twice changes nothing.
6. Resolves open escalations whose item is no longer open.

It runs on `/api/live` polls (only when the clock moved or the last tick is over 15 s old, and only if no
other tick holds the lock), on every clock advance (one tick per simulated day, plus one for the current
day first) and from `/api/cron/tick` (Vercel Cron; set `CRON_SECRET` to require `Authorization: Bearer`).

Default rules (illustrative): stage reminders −2 and 0 days, overdue +1, escalation +3/+7/+14 days;
deficiency replies −7/−2, +7/+15/+30; undertakings −30/−15/−7/−1, +7/+15/+30; documents −60/−30/−7,
+7/+15/+30. Escalation chain: L1 Regional Director, L2 Bureau Officer, L3 Bureau Head. All of it is
editable on the Rules page.

## Audit trail

Each entry stores `prev_hash` and `hash = SHA-256(prev_hash | canonical JSON of the entry)`. Entries are
written in the same transaction as the change they describe, under an advisory lock that serialises the
chain. A database trigger rejects `UPDATE` and `DELETE`. `verify_chain` recomputes every hash and reports
the first broken entry. Tests prove that editing or deleting an entry is detected.

## Synthetic data

`pnpm db:generate` runs `backend/app/data/seed.py`: it creates 7 Regions, 40 fictional institutions,
69 users (40 institution heads, 17 officials, 12 committee members) and 40 tracked documents, then
replays 300 simulated days through the real engines with per-case plans, ticking the alert engine every
day. The result (60 applications, 33 EVC visits, 27 undertakings, alerts, escalations, notifications and
an audit chain of about 1,800 entries) is consistent by construction and byte-identical on every run.
It is dumped to `data/seed.copy.gz`, which `pnpm db:seed` loads in a few round trips (fast on Neon too).
The Reset button restores a snapshot schema taken right after loading.

Scripted demo cases are tagged in `applications.demo_tag`: `demo_scrutiny`, `demo_returned`,
`demo_overdue_scrutiny`, `demo_l2`, `demo_evc_delayed`, `demo_visit_availability`, `demo_visit_report`,
`demo_sac`, `demo_decision`, `demo_legacy` (Ambervale undertaking due in 5 days), `demo_verification`,
`demo_overdue_undertaking`.

Names are invented: imaginary towns, and person surnames that are unusual nature words.

## KPI definitions

| KPI | How it is measured |
|---|---|
| Routing accuracy | Each application's non-reverted stage history must equal its route snapshot in order (prefix for open cases) |
| Alert timeliness | `ist_date(fired_at) = trigger_date` for every alert |
| Deadline tracking reliability | Independent SQL lists open items past due with no overdue alert (target 0) |
| Pendency visibility | Overdue cases from an independent query must appear on the dashboard and in the overdue report |
| Manual follow-up reduction | Count of automatic reminders, overdue alerts and escalations × an assumed setting (1) |
| Escalation coverage | Every overdue item must have each level whose day has passed, escalated on that day |
| Audit completeness | 12 record types matched to their audit actions, plus chain verification |
| Processing time per stage | Completed stages: average total days, institution days (paused time) and AICTE days |

## Security and scope

- Demo session: the cookie holds the user id with an HMAC signature (`SESSION_SECRET`). Forged cookies are rejected.
- Institutions see only their own cases, undertakings, documents and files; committee members only cases
  they are assigned to; only Bureau officers edit rules; only officials verify; only rank 2+ officials decide.
- File download checks the same scope. Uploads are limited to 2 MB and to PDF, PNG, JPEG and text.
- Parameters are always bound (no string-built SQL with user input).

## UI notes

- Theme "stone and pine": tokens in `frontend/app/globals.css` (see CLAUDE.md section 9). Small text on
  tinted fills uses the `-ink` variants (amber-ink `#8A5A12` on amber-tint is 5.2:1, red-ink on red-tint 5.5:1);
  the region tiles and chart ramp were checked so text on every step passes AA.
- Geist Sans and Geist Mono are bundled by the `geist` package, so the UI works offline.
- Tables support keyboard row navigation (arrow keys, Enter) and a side-sheet quick look; motion is
  transform/opacity only and switches off under `prefers-reduced-motion`.
- Polling `/api/live` every 3 s (6 s when the tab is hidden). The response carries the latest audit id;
  when it changes, every visible view refetches quietly.
- A request taking longer than 2.5 s shows "Waking up the server"; an unreachable API shows a Retry banner.

## Deploying on Vercel

1. Create a Neon database and run `pnpm db:init` and `pnpm db:seed` against it from your machine
   (`DATABASE_URL` in `.env`). Use Neon's pooled connection string for the deployed app.
2. Import the GitHub repo in Vercel. `vercel.json` defines two services: `web` (Next.js in `frontend/`)
   and `api` (FastAPI, `backend/app/main.py`, dependencies in `backend/requirements.txt`), with `/api/*`
   routed to the API. If your Vercel account does not offer services yet, set the project's Root Directory
   to `frontend`, deploy the API as a second project from `backend/`, and set `ARGUS_API_ORIGIN` on the web
   project to the API's URL (the Next.js rewrite then proxies `/api`).
3. Set `DATABASE_URL`, `SESSION_SECRET`, optionally `GROQ_API_KEY`, `LLM_MODEL` and `CRON_SECRET` in the
   Vercel project settings. Never commit `.env`.

Nothing in the app keeps state in memory or needs a long-running process: all state is in PostgreSQL and
the alert tick runs inside requests.

## Simplifications in v1

- Demo user picker instead of real login (by design; listed as future scope).
- Regional officers see all Regions' cases when they choose "All Regions"; strict per-Region data
  isolation for officials is not enforced (institutions and committees are strictly scoped).
- The simulated clock is global (shared by everyone using the same database).
- EVC availability uses a simple date picker; there is no calendar integration.
- The case summary and letters are drafts only; nothing is sent automatically.
