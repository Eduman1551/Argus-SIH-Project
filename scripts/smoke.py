"""Headless smoke run of the demo scenario through the API.

Resets the demo data, runs the eight guided steps as the demo users, asserts the key outcomes,
prints the KPI table (used for the README results), and resets the data again.
Needs DATABASE_URL (from .env or the environment). No running server is needed.

Usage: pnpm smoke
"""

from __future__ import annotations

import sys
import time
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
warnings.filterwarnings("ignore", message="Using `httpx`")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def main() -> int:
    c = TestClient(app)
    users = {u["code"]: u["id"] for u in c.get("/api/users/demo").json()["users"]}

    def login(code: str) -> None:
        c.cookies.clear()
        assert c.post("/api/session", json={"user_id": users[code]}).status_code == 200

    def check(cond: bool, msg: str) -> None:
        print(f"   {'PASS' if cond else 'FAIL'}  {msg}")
        if not cond:
            raise SystemExit(1)

    login("bureau-head")
    assert c.post("/api/demo/reset").status_code == 200
    print("Argus smoke run (SYNTHETIC DATA)\n")
    before = c.get("/api/dashboard", params={"all_regions": True}).json()["totals"]

    for step in c.get("/api/demo/scenario").json():
        t = time.perf_counter()
        r = c.post(f"/api/demo/scenario/{step['id']}")
        ms = (time.perf_counter() - t) * 1000
        print(f"{step['id']}. {step['title']}  ({ms:.0f} ms)")
        check(r.status_code == 200, f"step ran: {r.json().get('caption', r.text)[:220]}")
        body = r.json()
        if step["id"] in (5, 6):
            res = body["result"]
            check(res["alerts"] > 0, f"{res['alerts']} alerts, {res['escalations']} escalations fired while advancing")
        if step["id"] == 6:
            check(res["escalations"] > 0, "overdue items escalated up the chain")

    login("off-NR-1")
    case = c.get("/api/applications", params={"q": "ARG/2026/NR/0055"}).json()["rows"][0]
    check(case["stage_code"] == "evc", "the scrutiny demo case was routed to EVC after re-scrutiny")
    unds = c.get("/api/undertakings", params={"all_regions": True}).json()["rows"]
    amb = [u for u in unds if u["institution"].startswith("Ambervale") and u["condition_text"].startswith("Install")]
    check(bool(amb) and amb[0]["state"] == "closed", "Ambervale undertaking verified and closed")
    chain = c.post("/api/audit/verify").json()
    check(chain["valid"], f"audit chain valid across {chain['checked']} entries")
    foreign = next(r for r in c.get("/api/applications", params={"all_regions": True}).json()["rows"]
                   if not r["institution"].startswith("Ambervale"))
    login("inst-AMB")
    check(c.get(f"/api/applications/{foreign['id']}").status_code == 403,
          "an institution cannot open another institution's case")

    login("bureau-head")
    after = c.get("/api/dashboard", params={"all_regions": True}).json()["totals"]
    print(f"\nPendency before/after: {before['cases']} -> {after['cases']} cases, overdue {before['overdue']} -> {after['overdue']}")

    kpis = c.get("/api/kpi").json()["kpis"]
    print("\nKPI results (measured on the run above; targets are our suggestions)\n")
    print(f"{'#':<3}{'KPI':<38}{'Result':<16}{'Target':<12}Detail")
    print("-" * 110)
    for k in kpis:
        if k["id"] == 8:
            continue
        unit = "%" if k["unit"] == "%" else ""
        target = "-" if k["target"] is None else f"{k['target']}{unit}"
        detail = f"checked {k.get('checked', '')}" if k.get("checked") is not None else ""
        if k["id"] == 5:
            detail = f"{k['reminders']} reminders, {k['overdue_alerts']} overdue, {k['escalations']} escalations"
        print(f"{k['id']:<3}{k['name']:<38}{str(k['value']) + unit:<16}{target:<12}{detail}")
    print("\nKPI 8: average days per completed stage (AICTE/committee + institution)")
    for s in kpis[-1]["stages"]:
        print(f"   {s['name']:<26}{s['avg_days']:>6} days  ({s['avg_aicte_days']} + {s['avg_institution_days']}), "
              f"{s['completed']} done, {s['on_time_pct']}% on time")
    ok = all(
        (k["id"] in (5, 8)) or (k["value"] == 0 if k["unit"] == "items" else k["value"] == 100.0) for k in kpis
    )
    check(ok, "all KPIs at their suggested targets")

    assert c.post("/api/demo/reset").status_code == 200
    print("\nDemo data reset. Smoke run passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
