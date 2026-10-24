# Argus

Argus helps AICTE officers, institutions and expert committees track approval cases, deadlines and
undertakings in one place, so nothing slips through unnoticed. Built for SIH 2026, problem statement PS26262.

**Live demo:** not deployed yet (the Vercel link goes here once it is).

> Prototype, not an official AICTE system. **All data is synthetic**: every institution, person and case is
> fictional, and the rules and time limits are illustrative, not official APH figures.

## What it does

- **Routes** each application through the stages its type needs, and moves it on when a stage is done.
- **Watches deadlines** on role-based dashboards: scrutiny, expert visits, undertakings and document expiry.
- **Reminds and escalates** automatically: reminders before a due date, then escalation up a chain (L1 to L3).
- **Records everything** in a tamper-evident audit trail. People make every decision; Argus never approves or rejects.
- **Sees delays coming**: a transparent delay-risk score explains which cases are likely to slip and why, and suggests an action that an official approves or dismisses; the outcome is measured afterwards.

## Roles and login

- **Institution**: applies, answers deficiencies, uploads evidence and renewed documents.
- **Official**: scrutinises cases, verifies evidence, watches pendency and escalations.
- **Committee**: does expert visits and records recommendations.

Open `/login` and pick a demo user, grouped by role. Use **Switch user** or **Log out** in the avatar menu
(top right).

## Tech stack

Next.js, React, TypeScript and Tailwind CSS · FastAPI and Python · PostgreSQL · optional Groq for drafting.

## Quick start (Windows, PowerShell)

Needs Node 20.9+ with pnpm, Python 3.11 to 3.13 and a PostgreSQL database (local or Neon).

```powershell
git clone https://github.com/Eduman1551/Argus-SIH-Project.git
cd Argus-SIH-Project
pnpm install
copy .env.example .env      # then set DATABASE_URL in .env
pnpm run setup              # tables and synthetic data ("pnpm setup" alone is a built-in pnpm command)
pnpm dev                    # API on http://localhost:8001, web on http://localhost:3001
```

Open http://localhost:3001 and sign in.

## Environment variables

| Name | Needed |
|---|---|
| `DATABASE_URL` | yes |
| `SESSION_SECRET` | recommended |
| `GROQ_API_KEY`, `LLM_MODEL` | optional (offline templates are used without them) |
| `API_PORT`, `WEB_PORT`, `CRON_SECRET` | optional |

Never commit `.env`; `.env.example` lists the names.

## Tests

`pnpm test` (pytest), `pnpm lint` (ruff), `pnpm smoke` (demo scenario through the API) and `pnpm e2e` (UI click-through).

## Deploy

One Vercel project (Next.js plus the FastAPI function) with a Neon database; see `vercel.json`.

## More

- [docs/DEMO.md](docs/DEMO.md): a 4 to 5 minute demo script
- The **Guide** page in the app: how to use it, and a demo you can run step by step
- [docs/DETAILS.md](docs/DETAILS.md): architecture, commands, KPI results, screenshots, future scope
- [CLAUDE.md](CLAUDE.md): the full build brief
