# Argus: SIH 2026, PS26262

Read this whole file before writing code. Build **Version 1** of the prototype end to end, exactly as described here.

- **v1 (now):** everything in sections 3 to 5.
- **Later (not now):** everything in section 6. Do not build it, only list it in the README "Future scope".

---

## 1. What we are building

**Problem statement:** Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System (Smart Automation).

AICTE approves technical institutions through stages such as scrutiny / re-scrutiny, Expert Visit Committee (EVC) and SAC/SHC, as set out in the Approval Process Handbook (APH). Some approvals come with time-bound undertakings, and institutions must keep documents such as lease documents valid. Officers in different Regions follow all of this by hand, so deadlines slip, EVCs get delayed and documents expire unnoticed.

**Argus** ("the hundred-eyed watchman") is one secure, configurable platform that:

1. **Routes** each application through the stages its type requires and moves it forward automatically when a stage completes.
2. **Monitors** pendency, ageing, EVC scheduling, undertakings and document validity on role-based, real-time dashboards.
3. **Alerts and escalates** automatically: reminders before a deadline, overdue alerts, and escalation up a configurable chain.
4. **Records everything** in a tamper-evident audit trail.

Argus is **decision support and workflow automation only**. It never approves, rejects, grants or denies anything. Statutory scrutiny, verification, inspection and decisions stay with the competent human authority.

**Three roles only (no admin role):**

| Role | Who | What they do |
|---|---|---|
| **Institution** | The applying college | Submits applications, answers deficiencies, uploads undertaking evidence and renewed documents, sees only its own cases and deadlines |
| **Official** | AICTE Regional officer or Bureau officer | Scrutiny and re-scrutiny, returns cases with a reason, assigns tasks, verifies evidence, monitors pendency, receives escalations. A **Bureau officer** also has the "Rules and timelines" settings page. |
| **Committee** | EVC members, SAC/SHC members | Confirm availability, conduct visits, submit visit reports, review case summaries and give a recommendation. They see only the cases assigned to them. |

---

## 2. Ground rules (non-negotiable)

1. **Humans decide.** No automated approve, reject, grant or deny, anywhere. Decision actions exist only for the competent Official or Committee, and always record who, when and the reason. Automation is limited to routing, reminders, escalations, drafting summaries and record keeping.
2. **Rules are configuration, not code.** Stage routes, SLA days, reminder offsets, escalation chains and notification templates live in database tables and are editable on the Rules page. No deadline is hardcoded. **The seeded values are illustrative assumptions and not official APH figures. Say so in the UI and README.**
3. **Time is injected.** All deadline logic takes `now` from one platform clock (`backend/app/clock`). Never call `datetime.now()` inside rules. The clock is a **simulated clock** with "Advance 1 day / 7 days / 30 days" controls, so reminders and escalations can be demonstrated and tested.
4. **Every state change writes an audit entry in the same transaction.** The audit log is append-only and hash-chained (each entry stores the hash of the previous one), with a "Verify audit chain" button.
5. **The alert engine is idempotent.** One alert per (entity, rule, offset), enforced by a unique key. Running the engine twice never sends duplicates.
6. **All data is synthetic and fictional.** Fictional institutions, no real colleges, officers or committee members. Label "SYNTHETIC DATA" and "Prototype, not an official AICTE system" in the UI and README. Paraphrase the APH, never copy it.
7. **No fake numbers.** Every KPI, count and timing comes from real data or a real run. Never hardcode results.
8. **Serverless-safe from day one** (we deploy on Vercel): no WebSockets (use polling), no in-memory state that matters (all state in PostgreSQL), no background threads that outlive a request. See section 7.
9. **Works offline.** The LLM is optional. Every LLM feature has a template-based fallback.
10. **Windows first.** The developer is on Windows (PowerShell). No Makefile, no bash-only scripts. Use pnpm scripts, small Node `.mjs` scripts and Python scripts. Use `pathlib`.
11. **Scope discipline.** Build everything in section 4. Do not build section 6.

---

## 3. Architecture and flow (implement this)

```
Users (Institution | Official | Committee)
        -> Role-based web portal (Next.js)
        -> Backend API / access layer (FastAPI): identity + scoped authorization
              -> Workflow engine      (routes, stages, scrutiny, return/revert, committee tasks, decisions)
              -> Compliance engine    (undertakings, evidence review, document validity, renewals)
              -> Scheduling engine    (EVC queue, member availability, visit dates, visit reports)
        -> Shared platform services: documents + versions, deadline calculation + escalation,
           notifications + delivery tracking, audit + reports
        -> PostgreSQL | document storage | alert tick (event outbox)
        -> Reminders and escalations -> institution submits evidence -> official verifies -> case closed or escalated
```

**Application journey (workflow engine):** submitted, completeness / intake check, scrutiny, deficiency raised (reason required), institution response, re-scrutiny, next stage selected from the configured route, EVC if required, SAC/SHC or another prescribed stage if required, authorised decision (human). Routes are ordered stage lists in config: Only Scrutiny, Scrutiny + EVC, EVC + SAC/SHC, Only EVC, plus other combinations.

**SLA clocks:** every stage has a configured time limit. Time waiting on the institution is counted separately from time waiting on officials or committees (the SLA clock pauses for AICTE while a deficiency is open). The dashboards show both.

**EVC journey (scheduling engine):** visit required, committee assignment pending, availability and date coordination, visit scheduled, visit conducted, report submission pending, report submitted and reviewed. Delays at any step trigger reminders and escalation.

**Compliance journey:** approval with undertakings creates one record per condition with a due date. Then: reminders to the institution (configured offsets before the due date), evidence uploaded, official verifies (or asks for resubmission), closed. If nothing arrives by the due date: overdue alert, then escalation through the chain.

**Document validity journey:** each tracked document (lease and others) has an expiry date. Advance alerts, then renewal upload, then verification, then valid again. Expired and not renewed: overdue alert and escalation.

**Alert tick (the "background worker"):** a single idempotent function `run_alert_tick(now)`. It evaluates every open case, undertaking, EVC task and document against the rules, writes new alerts into the outbox table, creates notifications, and escalates. It runs (a) on every `/api/live` poll (cheap, guarded by a "last tick" timestamp), (b) whenever the clock is advanced, and (c) from an optional `/api/cron/tick` endpoint for Vercel Cron. It must be safe to call at any time and any number of times.

**Notifications:** in-app notification centre (bell with unread count) plus a **simulated email / SMS log** in the outbox with delivery status (queued, sent, delivered, failed). No real emails or SMS in v1, and the UI labels them "simulated".

**Module map**

| Module | Responsibility |
|---|---|
| `data/` + `backend/app/data` | seeded synthetic dataset and loader |
| `backend/app/clock` | simulated platform clock, advance, current time |
| `backend/app/rules` | configurable routes, SLAs, reminder offsets, escalation chains, templates |
| `backend/app/workflow` | application state machine, routing, transitions, guards, return/revert |
| `backend/app/scheduling` | EVC queue, availability, visit scheduling, visit reports |
| `backend/app/compliance` | undertakings, evidence, document validity, renewals |
| `backend/app/alerts` | alert tick, outbox, escalation engine |
| `backend/app/notifications` | in-app notifications, simulated delivery tracking, templates |
| `backend/app/documents` | upload, versioning, hash, size limit, download (permission checked) |
| `backend/app/audit` | append-only hash-chained audit log, verify |
| `backend/app/auth` | demo identity and scoped authorization (see below) |
| `backend/app/reports` | pendency, EVC, undertaking, document validity, overdue and Region-wise reports, CSV export |
| `backend/app/kpi` | KPI computation (section 8) |
| `backend/app/llm` | optional case-summary and letter drafting, offline templates |
| `backend/app/api` | FastAPI routes |
| `backend/db` | `schema.sql` and a small `psycopg` data-access layer (plain SQL) |
| `frontend/` | Next.js portal |

**Auth in v1 is a demo session, and we say so honestly.** Seeded demo users with a user picker (the role switcher in the top bar) and a signed session cookie. The backend still **enforces** scoped authorization on every route (institutions see only their own data, committees only assigned cases, only Bureau officers edit rules). Real login, SSO and password flows are future scope.

---

## 4. v1 IN SCOPE (build all of it)

| # | Feature | Done when |
|---|---|---|
| 1 | **Synthetic dataset**, seeded and deterministic (see section 5) | Same seed gives the same data. Includes scripted demo cases. |
| 2 | **Rules engine and Rules page** (Bureau officer only): routes, SLAs, reminder offsets, escalation chain, templates | Changing a rule changes behaviour with no code change. The change is audited. |
| 3 | **Application intake and routing** by application type | Each route type sends the case to the correct stages in order. Tested for every route. |
| 4 | **Scrutiny and re-scrutiny**: assignment by workload, SLA timer, return with mandatory reason, institution response, automatic move to the next stage | Illegal transitions are rejected. The SLA clock pauses and resumes correctly. |
| 5 | **Committee stage (SAC/SHC)**: queue, electronic case summary, recommendation recorded | Summary is generated from case facts (LLM optional). The recommendation is a human action. |
| 6 | **Decision recording**: a human records the decision, with an approval-with-undertakings option that creates undertaking records | The system never decides. The audit shows who decided. |
| 7 | **EVC queue and scheduling**: queue after preliminary processing, committee assignment, availability, visit date, visit report, delay alerts | Scheduling board shows due, approaching and delayed EVCs. |
| 8 | **Undertaking and compliance tracking**: conditions, due dates, evidence upload, verification, resubmission, closure | Full lifecycle works end to end with reminders and escalation. |
| 9 | **Lease and document validity monitoring**: expiry tracking, advance alerts, renewal upload, verification, overdue escalation | Expiry board with Valid / Expiring soon / Expired / Renewal submitted. |
| 10 | **Alert and escalation engine** with the simulated clock | Reminders fire at exactly the configured offsets, once. Overdue items escalate L1, L2, L3. |
| 11 | **Notification centre** and simulated email/SMS log with delivery status | Each alert produces a notification and an outbox row. |
| 12 | **Role-based dashboards** (section 9) | Each role sees a different, useful dashboard. |
| 13 | **Pendency monitoring**: ageing, stage-wise counts, Region-wise counts, bottlenecks, time waiting on institution vs officials | Numbers match the data. Drill-down to the case list. |
| 14 | **Audit trail** with hash chain and a Verify button; per-case timeline | Every action, alert, submission, verification, escalation and closure is logged. |
| 15 | **Reports** with CSV export (pendency, EVC status, undertaking compliance, document validity, overdue cases, Region-wise performance) | Report totals match the dashboards. |
| 16 | **Documents**: upload, versioning, SHA-256, size limit, permission-checked download | An institution cannot read another institution's file. |
| 17 | **Simulated clock controls** and an "Run demo scenario" guided mode | Advancing time visibly fires reminders and escalations. |
| 18 | **All KPIs live** (section 8) | Numbers come from real data. |
| 19 | **Tests, README, DEMO.md, smoke script** | See section 10. |

---

## 5. Synthetic data

Deterministic seed. Roughly: **40 fictional institutions**, **60 applications** across **7 Regions** at different stages and all four route types, **~15 officials** (Regional and Bureau), **~12 committee members** (EVC and SAC/SHC), **~25 undertakings**, **~40 tracked documents** with expiry dates spread around the simulated "today", and **~10 EVCs** at different points. Include deliberate edge cases: overdue scrutiny, a delayed EVC, an undertaking due in 5 days, a lease expiring in 20 days, an expired lease with no renewal, a returned application waiting on an institution, a case already at L2 escalation.

Include **scripted demo cases** (named in the data generator) that make `docs/DEMO.md` work every time. Institution and person names must be obviously fictional and must not match real colleges or real people. Region names may be generic (Northern, Southern, Eastern, Western, Central and so on).

---

## 6. OUT OF SCOPE for v1 (future scope; do NOT build, only list in the README)

- Integration with real AICTE systems, real SSO / DigiLocker / e-Sign, real login and password management
- Real email, SMS and WhatsApp delivery
- Automated document content checks (OCR, authenticity checks)
- AI-based risk scoring or prediction of delays
- Mobile app, multilingual UI
- Advanced analytics and cross-year trends
- An admin / user-management role and user self-registration
- Full APH rule coverage for every approval type and scenario
- Geo-tagged inspections, video visits

---

## 7. Tech stack (fixed, and built to deploy on Vercel)

| Layer | Choice |
|---|---|
| Backend | Python 3.11 to 3.13, FastAPI, Pydantic v2 |
| Storage | **PostgreSQL** only (Neon in cloud, local Postgres in dev), via `psycopg` (v3) with plain SQL and `backend/db/schema.sql`. **No ORM, no SQLite.** Connection string from `DATABASE_URL`. `pnpm setup` / `pnpm db:init` creates the tables. |
| Documents | Behind a small `storage` interface. v1 stores files in PostgreSQL (`bytea`, max 2 MB each, versioned, SHA-256), because Vercel functions have no persistent disk and a request body limit of about 4.5 MB. |
| Live updates | **Polling** of `GET /api/live` every 3 s (6 s in a background tab). **No WebSockets.** |
| Scheduling of alerts | The idempotent alert tick from section 3. Optional Vercel Cron on `/api/cron/tick`. No threads, no APScheduler. |
| LLM (optional) | **Groq** (free tier) via the `groq` SDK behind a thin interface, for drafting case summaries and deficiency / reminder letters (clearly labelled "Draft, to be reviewed by the officer"). `GROQ_API_KEY` and `LLM_MODEL` from env. **Do not use the Anthropic API or any paid LLM API.** Offline template fallback is mandatory. |
| Frontend | **Next.js (App Router) + React + TypeScript**, Tailwind CSS, lucide-react, Zustand, Recharts for charts. Client components talk to the backend through relative `/api/...` paths (one Vercel project, no CORS). No business logic in Next API routes. |
| Tooling | **pnpm** (not npm/yarn), **tsx** for TS scripts (not ts-node), pytest, ruff, `concurrently` for `pnpm dev` (API on 8001, web on 3001; configurable via `API_PORT` / `WEB_PORT`, because another project uses 8000/3000) |

**Deploy as one Vercel project:** the Next.js app plus the FastAPI app as a Python function under `/api` (an `api/index.py` entrypoint and a `vercel.json`). Keep the Python bundle lean (no heavy libraries are needed here). Keep local development working with `pnpm dev`. Environment variables are set in Vercel settings only. Never commit `.env`.

---

## 8. KPIs (all live; targets are OUR suggestions, label them so, not official requirements)

These map to the PS evaluation criteria.

| # | KPI | Measure | Suggested target |
|---|---|---|---|
| 1 | Workflow routing accuracy | % of test applications routed through the correct ordered stages | 100% |
| 2 | Alert timeliness | % of alerts generated at the correct configured offset on the simulated clock | 100% |
| 3 | Deadline tracking reliability | Count of due or overdue items NOT flagged by the engine | 0 |
| 4 | Pendency visibility | % of overdue cases visible on the relevant dashboard and in reports | 100% |
| 5 | Manual follow-up reduction | Reminders and escalations sent automatically, versus an assumed one manual follow-up each (config value, labelled "assumed") | shown as a count |
| 6 | Escalation coverage | % of overdue items that reached the correct escalation level on time | 100% |
| 7 | Audit completeness | % of state changes, alerts, submissions and verifications with an audit entry, plus a chain verification result | 100% and chain valid |
| 8 | Average processing time per stage | From case data, split into waiting on institution and waiting on officials/committees | shown |

Show these on a Results / Performance page with a one-line plain explanation each.

---

## 9. Frontend / UX (this decides how it feels to SIH judges)

Multi-page app (Next.js App Router), desktop-first, good at 1366x768 and 1920x1080 with no horizontal scroll. Each page has one purpose. Plain English. A page pattern like this: title, one-line description, at most one primary button, a dismissible "What to do here" box (remembered in localStorage), and a "Next: ..." button at the bottom. Empty states say what to do next, and loading uses skeletons. Technical terms stay out of main copy.

**Theme: red and light-brown paper (light only).** It should feel like a good government paper file: warm, calm and official, not a generic SaaS blue.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F3E9D8` | page background (warm light brown) |
| `--paper-2` | `#EADCC3` | sidebar, table headers, hover |
| `--card` | `#FBF6EC` | cards and panels (lighter sheet) |
| `--ink` | `#3B2A1E` | main text (dark brown, never pure black) |
| `--ink-soft` | `#6B5744` | secondary text |
| `--line` | `#D6C3A3` | borders and dividers (tan) |
| `--red` | `#B3262D` | primary buttons, links, active nav, key accents |
| `--red-deep` | `#7E1B22` | headings accents, hover, escalated state |
| `--red-tint` | `#F6DDD8` | selected rows, subtle highlights |

- **Status colours** (always paired with a text label or icon, never colour alone): on track `#5B7B3A` (olive green), due soon `#B7791F` (ochre), overdue `#B3262D` solid with the word OVERDUE, escalated `#7E1B22` with an icon and level (L1/L2/L3). Verified / closed uses olive green. Neutral / waiting uses `--ink-soft`.
- **Look:** a very subtle paper grain on the page background (CSS or a tiny inline SVG noise, low opacity, no heavy images), cards like sheets with a thin tan border and soft warm shadow, small corner radius (6 to 8 px). Status badges can look like small rubber stamps (outlined, uppercase, slight letter spacing, no rotation that hurts reading). Tables look like ruled ledger paper (light row lines, tan header).
- **Type:** headings in a serif (Source Serif 4) and body in Inter, both bundled locally via `next/font/local` so it works offline. Large readable text, a visible keyboard focus ring in red, and WCAG AA contrast on the paper background (check the red on paper and the ochre on paper).
- **Charts (Recharts):** use the palette above. Ageing heat uses tan to red-deep. Stage bars use brown tints with red for overdue. Always label axes and values.
- **Motion:** transform and opacity only after mount (never start content at opacity 0), and respect reduced motion.

**Shell:** a fixed left sidebar (icons plus plain labels, collapsible to an icon rail with tooltips, remembers the choice, auto-collapses below 1280 px). It changes with the role. The top bar shows a "SYNTHETIC DATA / Prototype" banner, the **simulated clock** (date, and Advance +1 day / +7 days / +30 days, Reset), the **role switcher** (demo user picker), the notification bell with an unread count, and a connection indicator.

**Pages**

| Role | Route | Purpose |
|---|---|---|
| Institution | `/` Home | My applications and current stage, pending actions, deficiencies and response dates, EVC schedule, open undertakings, evidence awaiting verification, documents expiring soon |
| Institution | `/applications/[id]` | Case timeline, deficiency response form, uploads |
| Institution | `/undertakings`, `/documents` | Submit evidence and renewals, see due dates and status |
| Official | `/` Dashboard | Counts by Region and stage, stage-wise ageing, unassigned tasks, total elapsed time, time waiting on institution vs officials, near-deadline and overdue lists |
| Official | `/queue` | My tasks, unassigned tasks, assign / reassign |
| Official | `/applications`, `/applications/[id]` | Filterable list; case page with timeline, documents, actions (assign, return with reason, advance, record outcome) and the case summary |
| Official | `/evc` | EVC scheduling board: queue, scheduled, due, delayed |
| Official | `/compliance` | Undertakings and verification queue |
| Official | `/validity` | Document expiry board |
| Official | `/escalations` | Overdue items by escalation level |
| Official | `/reports` | The six reports with filters and CSV export |
| Official | `/audit` | Audit log with filters and the Verify chain button |
| Bureau officer only | `/settings/rules` | Routes, SLAs, reminder offsets, escalation chain, templates |
| Committee | `/my-cases` | Assigned EVC visits and SAC/SHC cases |
| Committee | `/visits/[id]` | Availability, visit confirmation, report submission |
| Committee | `/cases/[id]` | Case summary and recommendation form |
| All | `/notifications` | Notification centre and the simulated delivery log |
| All | `/performance` | The KPIs from section 8 |
| All | `/guide` | How to use, the demo script and "Run demo scenario" (scripted, captions from real results) |

**Feedback:** toasts for success and errors; an unreachable API shows a banner with Retry; a slow first request (serverless cold start) shows "Waking up the server" and not an error. Every number on screen comes from the backend.

---

## 10. Quality bar (what SIH judges test, so build for it)

- **It must really work end to end:** submit, route, scrutiny, deficiency, response, re-scrutiny, EVC schedule, decision with undertakings, evidence, verification, closure, plus expiry alerts and escalation after advancing the clock. No dead buttons, no console errors.
- **Reliable demo:** deterministic seed, scripted demo cases, one-command start, a reset button.
- **Honest:** synthetic data and illustrative rules stated, humans decide, simulated notifications labelled.
- **Credible engineering:** modular code, typed models, config-driven rules, tests that pass, a clean README.
- **Polish:** consistent theme, loading/empty/error states, nothing half-built visible.

**Tests (pytest):** routing for every route type; illegal transitions rejected; return requires a reason; SLA pause and resume; reminders fire at exactly the configured offsets and only once (run the tick twice); escalation chain L1 to L3; document expiry states; undertaking lifecycle; audit hash chain detects tampering; **permission tests** (an institution cannot read another institution's case or file, a committee member cannot see unassigned cases, only a Bureau officer can edit rules, no endpoint decides automatically); report totals equal dashboard totals.

**`scripts/smoke.py`:** a headless run of the demo scenario through the API. It asserts the key outcomes and prints the KPI table (this feeds the README results).

**README:** problem, solution, architecture (a Mermaid diagram of section 3), setup and run steps (Windows), demo steps, measured KPI results, synthetic-data and illustrative-rules note, tech stack, future scope. Keep it short and clear. Put long details in `docs/DETAILS.md`.

**`docs/DEMO.md`:** a 4 to 5 minute script: (1) institution view of its cases and deadlines, (2) submit or open an application and watch it route, (3) official raises a deficiency, the institution responds, re-scrutiny moves it on, (4) EVC scheduling board and a delayed EVC alert, (5) advance the clock so an undertaking and a lease expiry trigger reminders and then an escalation, (6) the official verifies evidence and closes the case, (7) the audit trail and Verify chain, (8) the dashboards, reports and the KPI page.

---

## 11. Build order and git workflow

The repo already exists locally (`Argus-SIH-Project`, with a README and `.git`). Run `git remote -v` first. The expected remote is `origin` = `git@github.com:Eduman1551/Argus-SIH-Project.git` on branch `main`. If no remote is set, tell the user and keep committing locally.

**Commit and push after every finished module, not at the end.** Run that module's tests, make sure the app is not broken, then:
`git add -A && git commit -m "..." && git push origin main`

Suggested milestones:
1. Scaffold: folders, `.gitignore`, `.env.example`, root `package.json`, setup/run scripts, this CLAUDE.md
2. Schema, clock and rules config tables
3. Synthetic dataset generator and loader
4. Audit log with hash chain
5. Workflow engine and routing + tests
6. Scrutiny, deficiency and response flow
7. Scheduling engine (EVC) + tests
8. Compliance engine (undertakings, document validity) + tests
9. Alert tick, escalation and notifications + tests
10. Auth (demo session), scoped permissions and documents + tests
11. API routes, reports and KPIs
12. Frontend: shell, theme, role switcher, clock controls
13. Frontend: institution pages
14. Frontend: official dashboard, queue, case page
15. Frontend: EVC, compliance, validity, escalations
16. Frontend: committee pages, rules page, reports, audit, performance
17. Optional LLM drafting and offline templates
18. Vercel setup (`api/index.py`, `vercel.json`), polish pass, smoke script, README, DEMO.md

**Commit message rules (they must read like a real student developer wrote them):**
- Short plain subject, about 60 characters or fewer, imperative, specific to what changed. Lowercase is fine.
- No emoji. No `feat:` / `chore:` prefixes. No marketing words (robust, seamless, comprehensive, leverage, enhance, streamline).
- Optional body of 1 to 3 plain lines, only when the why is not obvious.
- Good: `add rules tables and seed reminder offsets` · `scrutiny: pause sla clock while institution replies` · `fix duplicate reminders when tick runs twice`
- Commits must match real changes. No empty or filler commits. A real bug found while testing is its own small `fix ...` commit.

**Git safety:** never force-push or rewrite history. If a push fails, keep committing locally, tell the user, and continue. Never commit `.env`, API keys, `.venv`, `node_modules`, `__pycache__`, `.next` or build output. Commit `.env.example` instead.

---

## 12. Working style

- Make a short plan and a todo list, then **build through all milestones without waiting for approval between modules.** Stop only if truly blocked.
- Verify as you go: run tests, run the app, and look at the UI (screenshots via Playwright if available) before calling a UI module done.
- Edit existing files with targeted changes. Do not regenerate whole files for small fixes.
- Skip minor nitpicks. Flag only significant issues or trade-offs.
- Keep status updates short. At the end report: what works, what is simplified, how to run it, known limitations.
- **If time gets tight, cut in this order:** LLM drafting (keep templates), committee SAC/SHC extras, report CSV exports, audit Verify button polish. **Never cut:** routing, the deficiency loop, the EVC board, undertaking and document-validity tracking, the alert and escalation engine with the simulated clock, role-based dashboards, the audit trail.
