# Argus: deployment test report

**Site:** https://argus-sih-2026.vercel.app (Vercel project `argus-sih`, region `sin1`; Neon PostgreSQL in
Singapore). **Date:** 24 Oct 2026. **Commit tested:** `6d098c4` (auto-deployed from `main`).
All data is synthetic. Re-run with `pnpm live-test https://argus-sih-2026.vercel.app`.

**Result: all local checks pass and 55 of 55 live checks pass.** The live run had no 5xx responses, no browser
console errors, and no secret value in the 4,521 responses it scanned. The audit chain was valid at the end, and
the demo was reset to its clean state.

## Local checks (before deploying)

| Check | Result |
|---|---|
| Backend tests (`pytest`, local PostgreSQL) | 68 passed |
| Lint (`ruff`) | clean |
| Frontend type check (`tsc --noEmit`) | clean |
| Production build (`next build`) | built |
| Smoke run (`pnpm smoke`) | passed, all KPIs at their suggested targets |
| UI click-through (`pnpm e2e`, local) | 15 of 15 steps, no console errors |

## Live checks (Playwright, 1366x768 and 1024 wide)

| # | Area | What was checked | Result |
|---|---|---|---|
| 1 | Health | `/api/health`: database connected, schema version `d8bff8b8346e`, all tables present, data loaded | Pass |
| 1 | Health | First page load (logged out, lands on `/login`) in 0.9 s; no 5xx in the whole run | Pass |
| 2 | Auth | Logged out: pages redirect to `/login`; `/api/dashboard`, `/api/applications`, `/api/audit` answer 401 | Pass |
| 2 | Auth | Sign-in from `/login` as Institution, Regional officer, Bureau officer, EVC member, SAC/SHC member | Pass |
| 2 | Auth | Session cookie is HttpOnly, Secure and SameSite=Lax | Pass |
| 2 | Auth | Institution sees only its own cases; another institution's case and the audit log are refused (403 and a refusal page) | Pass |
| 2 | Auth | Committee member cannot open unassigned cases or the queue | Pass |
| 2 | Auth | Only the Bureau officer can change rules (403 for the others) | Pass |
| 2 | Auth | Log out from the avatar menu, then pages redirect, APIs answer 401, and signing in as another role works | Pass |
| 3 | Institution | New application submitted and routed to the completeness check | Pass |
| 3 | Institution | Deficiency reply with a file under the limit; a 2.5 MB file shows "Files must be 2 MB or smaller." | Pass |
| 3 | Institution | Server refuses a file over 2 MB with a clear message (422) | Pass |
| 3 | Institution | Own file downloads; another institution gets refused | Pass |
| 3 | Institution | Undertaking evidence submitted; document validity page shows statuses | Pass |
| 4 | Official | Queue; return with a reason (drafted letter); verify evidence; complete re-scrutiny (case moves to EVC) | Pass |
| 4 | Official | Assign EVC members; fix the visit date once members offered dates; reassign the case | Pass |
| 4 | Official | Escalations by level (My Region and All Regions) | Pass |
| 4 | Official | Reports load, CSV export works, pendency totals equal the dashboard totals | Pass |
| 4 | Official | Audit page: Verify audit chain says intact | Pass |
| 4 | Official | Bureau officer edits a time limit: saved, kept after reload, `rule.changed` in the audit trail | Pass |
| 5 | Committee | EVC member: my cases, confirms availability, marks the visit conducted, submits the report | Pass |
| 5 | Committee | SAC/SHC member records a recommendation; Regional Director records the decision with an undertaking | Pass |
| 6 | Intelligence | Dashboard: High / Medium / Low counts, Needs attention, Where delays are building | Pass |
| 6 | Intelligence | Case page: Why at risk, How this was calculated, Recommended action; Approve runs the action (brought to L3), is audited and listed | Pass |
| 6 | Intelligence | Dismiss with a reason | Pass |
| 6 | Intelligence | Institution, committee member and an officer of another Region get 403 on approve and dismiss | Pass |
| 6 | Intelligence | The approved action's outcome is measured after the clock moves on (day-7 checkpoint recorded) | Pass |
| 7 | Time | +1, +7 and +30 days from the date chip; each toast matches the engine's counts exactly | Pass |
| 7 | Time | After +7 days: new email/SMS log rows (+162), audit version moves, NR/0047 risk 64 to 67 | Pass |
| 7 | Time | Lists show On track, Due soon, Overdue and escalated items | Pass |
| 7 | Time | Reset from the date chip restores 15 May 2026 | Pass |
| 7 | Time | `/api/cron/tick`: 401 without or with a wrong secret, 200 with it; a second run creates 0 alerts (idempotent) | Pass |
| 8 | Live updates | A second session's date chip updates 1.2 s after another user advances the clock, with no reload and no reconnecting state | Pass |
| 9 | Pages | 31 pages across 5 roles plus `/login` at 1366 px and again at 1024 px: all render, no horizontal scroll | Pass |
| 9 | Pages | Navbar dropdown, Ctrl+K palette (jump to Reports), notification popover, avatar menu | Pass |
| 9 | Pages | Footer note only (no synthetic-data banner); empty state reads "No applications match these filters." | Pass |
| 9 | Pages | No browser console errors in the whole run | Pass |
| 10 | Data safety | No secret value in any API response, page source or script (4,521 responses) | Pass |
| 10 | Data safety | No secret value, 5xx or error-level entry in the retained runtime logs | Pass |
| 10 | Data safety | Audit chain valid after all of the above (2,065 entries) | Pass |
| 11 | Reset | `POST /api/cron/reset` (secret-protected) restores the clean demo; run at the start and the end | Pass |

## Bugs found and fixed

| Bug | Fix |
|---|---|
| The first deployment answered 500 on every API call: Vercel installed dependencies from the root `pyproject.toml`, which only held ruff and pytest settings, so `psycopg` was missing. | Moved the tool settings to `ruff.toml` and `pytest.ini` and removed `pyproject.toml`; the root `requirements.txt` now lists the five runtime packages directly. Previously it was an `-r` include with a byte-order mark. |
| The session cookie was never marked Secure. | Secure is set on HTTPS (from `x-forwarded-proto`); logout expires the cookie with the same flags. |
| The cron endpoint was open if `CRON_SECRET` was missing. | On Vercel the cron endpoints refuse every call without the secret; the comparison is constant-time. |
| There was no safe way to reset the live demo from outside the app. | Added `POST /api/cron/reset` (same secret) and `pnpm reset:live`. |
| `/api/health` only said "ok". | It now reports the database connection, schema version, whether every table exists and whether data is loaded. |

Issues in the test script itself (not the app) were fixed in `scripts/live-test.mjs`:
- **Refusal pages:** they have no `h1`, so the page-load wait never finished.
- **Clock popover:** it stays open after an advance, so clicking the chip again closed it.
- **Evidence form:** it opens from a toggle.
- **Visit date:** it can only be fixed after members have offered dates.
- **Escalations:** the seeded Region has no open escalations, so the check switches to All Regions.

## Timings

| Measurement | Value |
|---|---|
| First request to a fresh deployment (cold start), `/api/health` | 0.85 s (includes a new TLS connection) |
| Warm API request | 0.2 to 0.8 s |
| First page load, logged out | 0.9 s |
| +7 days / +30 days from the date chip, including the toast | 1.2 s / 2.7 s |
| Polling update seen by a second session | 1.2 s |
| Full live test (55 checks) | about 4.5 minutes |

## Known limits

- **Daily cron only:** the Hobby plan allows one cron run per day, so the cron tick runs at 04:00 UTC. The demo
  does not depend on it: every `/api/live` poll and every date-chip advance runs the same tick.
- **Cold starts:** after a quiet period the first requests can take a few seconds; the app shows "Waking up the
  server" instead of an error. This banner appeared on a few page loads during the first test run.
- **One shared demo:** everyone who opens the site shares one dataset and one simulated clock. Reset before a demo.
- **Short log retention:** Hobby keeps about an hour of runtime logs, so the log scan covers that window only.
- **Dropped connections in tests:** the test client occasionally saw a dropped keep-alive connection
  (`ECONNRESET`, never an HTTP error). Browsers retry these by themselves; the script retries once and lists any
  retry in its results. The final run needed none.
- **Preview URLs need a Vercel login:** deployment protection is "all except production domains", so
  `argus-sih-2026.vercel.app` is public and per-deployment preview URLs need a Vercel login.
