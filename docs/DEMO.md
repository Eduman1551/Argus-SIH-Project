# Argus demo script (4 to 5 minutes)

Start the app with `pnpm dev` and open **http://localhost:3001** (the API answers on
http://localhost:8001/api/health; both ports can be changed with `WEB_PORT` / `API_PORT` in `.env`).
With no session you land on the **sign-in page** (`/login`): pick a demo user to sign in.

Everything below uses the scripted cases in the synthetic dataset, so it works the same every time.
Before you start, open the **date chip** in the navbar and press **Reset**, so the simulated date is
**Fri, 15 May 2026**. To change user, open the **avatar menu** (top right) → **Switch user**; **Log out** ends
the session and returns to the sign-in page. **Ctrl+K** jumps to any page or case.

> Shortcut: the **Guide** page has **Run demo scenario**, which performs the same steps through
> the engines and writes each caption from the real result.

## 1. Institution view (30 s)

User: **Dr. Kavya Larkspur**, Ambervale Institute of Technology.

- Home shows **What needs you** sorted by due date: an undertaking due on **20 May (in 5 days)** and the
  **land lease expiring on 4 June (in 20 days)**. The **Next 90 days** calendar shows the same deadlines,
  with anything due within a week outlined in amber.
- *My applications*: **ARG/2026/NR/0055** is in **Scrutiny**, on track. The bar shows time used in the stage;
  click the row for a quick look in a side sheet.
- Point out the footer line ("Prototype · all data is synthetic"); the Guide page states the rest:
  illustrative rules, simulated delivery, humans decide.

## 2. Submit an application and watch it route (40 s)

Still as Kavya: **New application** → type *New technical institution*. The form shows the route this type
will follow (Completeness check → Scrutiny → EVC → SAC/SHC → Decision), taken from the Rules page.
Submit. The case page opens at stage 1, already **assigned to an officer by workload**, with its due date.
The timeline at the bottom shows each step written to the audit trail; click an event to see its audit hash.

## 3. Deficiency, reply, re-scrutiny (60 s)

1. User **Arjun Wrenfield** (Regional officer) → **My queue** → open **ARG/2026/NR/0055**.
2. **Return with deficiency**: type a reason (it is mandatory), optionally **Draft letter** (labelled
   "Draft, to be reviewed by the officer"; works offline). Return it. The stage card now says
   **AICTE time limit: Paused**.
3. Switch to **Kavya** → open the case → **Reply to deficiency**, attach a PDF, send.
4. Switch back to **Arjun** → **Complete scrutiny**. The case moves **by itself** to **Expert Visit (EVC)**
   and appears in the EVC queue. The route line at the top shows how many days each stage took and how many were
   waiting on the institution.

## 4. Expert visits and a delayed visit (40 s)

- As Arjun → **Monitoring → Expert visits** → switch to **All Regions**. **ARG/2026/ER/0017** sits in the red
  **Delayed** column: its visit date passed and it is already escalated to L1.
- **ARG/2026/NR/0032** is in **Due now**: the visit is today.
- Optional: switch to **Prof. Vikram Duskwood** (EVC convenor) → *My cases* → open the visit →
  **Mark visit conducted** → **Submit visit report**.

## 5. Advance the clock: reminders, overdue, escalation (50 s)

- Open the date chip and press **+7 days** (now 22 May). The toast says what happened, for example
  "7 days advanced: 12 reminders sent, 3 items overdue, 1 escalated to L2". The bell count rises. Ambervale's undertaking got its 1-day reminder on 19 May and its **overdue alert on 21 May**.
- Press **+30 days** (now 21 June). The lease got its 7-day reminder, then **expired**, then escalated; the
  undertaking climbed **L1 → L2 → L3**.
- Open **Escalations** (as Arjun or **Ritu Emberly**, Bureau Head): one row per overdue item with the levels
  it reached. Click a row: the **escalation ladder** shows who was alerted at each level and when the next
  level is due.
- **Notifications** → *Email and SMS log* (simulated): every alert produced an in-app notification plus
  email and SMS rows with delivery status (queued, sent, delivered, failed). Nothing real is sent.

## 6. Evidence, verification, closure (40 s)

1. **Kavya** → **Undertakings** → the overdue undertaking → describe the evidence, upload a file,
   **Submit evidence**.
2. **Arjun** → **Compliance** → *To verify* → **Verify**. The undertaking is closed and its
   escalations are resolved on the next check (see *Escalations → Recently resolved*).

## 7. Audit trail (30 s)

**Audit trail** → **Verify audit chain**: "Chain intact: all N entries verified". Click any entry: a side sheet shows
its details and how its hash links to the previous entry. Every action, alert, submission, verification,
escalation and closure from this demo is in the list. (The test suite shows that editing or deleting a
past entry makes verification fail at that exact entry.)

## 8. Dashboards, reports and KPIs (40 s)

- **Dashboard** (Arjun or Ritu): the **process line** shows how many cases sit at each step, with one dot per
  case; click *Scrutiny* to list those cases. Below it, the **Regions** tab (click a tile to scope the page)
  and the **Deadlines** tab (90-day calendar).
- **Reports**: six reports with Region filter and **Download CSV**; totals match the dashboard. Click a row
  for every field.
- **Performance**: all eight KPIs computed live, plus **Run self-test** (one application of each type
  routed through every stage inside a rolled-back transaction).

## Optional extras

- **Dr. Nandini Hazelbrook** (Regional Director) → **ARG/2026/NR/0021** → **Record decision** →
  *Approved with undertakings* → add a condition. Undertakings are created and tracked from that moment.
  An Assistant Director or a committee member cannot record a decision.
- **Dr. Sana Thistledown** (SAC/SHC) → *My cases* → **ARG/2026/WR/0022**: electronic case summary built
  from case facts (Redraft uses Groq if configured, otherwise the offline template) → **Record recommendation**.
- **Ritu Emberly** (Bureau Head) → **Rules**: drag a stage chip to reorder a route, or change a
  reminder day with the stepper and watch the preview dates move before saving. It applies at once and
  appears under *Change history* and in the audit trail as `rule.changed`.

Other scripted cases: **ARG/2026/SR/0039** returned and waiting on the institution (reply overdue, L1),
**ARG/2026/WR/0043** scrutiny overdue, **ARG/2026/CR/0036** already at **L2**, Rivenmoor College's lease
expired with no renewal, Oakhaven's fire NOC renewal waiting for verification.

## Log out and back in (20 s, optional)

Avatar menu → **Log out**. You are back on the sign-in page; opening any page (for example `/queue`) sends
you there again, and the API answers 401. Sign in as a different role: only that role's pages and data show.

## Intelligence: from risk to outcome (90 s, start from Reset)

Numbers below are what the seeded data gives after Reset; they come from the engine, not from this script.

1. As **Arjun Wrenfield** → **Overview**. Next to the metrics: **Needs attention** (High / Medium / Low counts and up to
   five cases with a recommended action) and **Where delays are building** (top 3). On the process line, the stations
   carrying the most projected delay are marked "delay building".
2. Open **ARG/2026/NR/0047** (Brightwater, Scrutiny): the pill says **Medium risk 64**.
3. Date chip → **+7 days**. Open NR/0047 again: now **High risk 67**. **Why at risk** gives the reasons in points
   (time limit used, 29 days at Scrutiny, remaining work), where the time went, and "How this was calculated".
4. **Recommended action**: "Stage taking too long: bring the case to the next level", with the reason and the estimated
   days saved. Press **Approve**: the escalation chain already has it at L2, so it is brought to L3 (Ritu Emberly). The approval is in the timeline and the
   audit trail with your name. (Try it as Kavya or Prof. Duskwood: they cannot see or approve it.)
5. Still as Arjun, **Complete scrutiny**. The case moves to the expert visit and the risk drops to **Low**.
6. Date chip → **+7 days**. The case page now shows the outcome under the action: risk 67 → 37, projected delay 9 days → 0.
   **Performance** → *Intelligence results* shows the success rate, days saved, prediction accuracy and false alerts.

