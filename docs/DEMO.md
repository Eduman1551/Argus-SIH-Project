# Argus demo script (4 to 5 minutes)

Start the app with `pnpm dev` and open **http://localhost:3001** (the API answers on
http://localhost:8001/api/health; both ports can be changed with `WEB_PORT` / `API_PORT` in `.env`).

Everything below uses the scripted cases in the synthetic dataset, so it works the same every time.
Before you start, press the **Reset** button (↺ next to the clock) so the simulated date is
**Fri, 15 May 2026**. Switch users with the person menu at the top right.

> Shortcut: the **Guide and demo** page has **Run demo scenario**, which performs the same steps through
> the engines and writes each caption from the real result.

## 1. Institution view (30 s)

User: **Dr. Kavya Larkspur**, Ambervale Institute of Technology.

- Home shows **Pending actions** sorted by due date: an undertaking due on **20 May (in 5 days)** and the
  **land lease expiring on 4 June (in 20 days)**.
- *My applications*: **ARG/2026/NR/0055** is in **Scrutiny**, on track.
- Point out the red banner: synthetic data, prototype, illustrative rules.

## 2. Submit an application and watch it route (40 s)

Still as Kavya: **New application** → type *New technical institution*. The form shows the route this type
will follow (Completeness check → Scrutiny → EVC → SAC/SHC → Decision), taken from the Rules page.
Submit. The case page opens at stage 1, already **assigned to an officer by workload**, with its due date.
The timeline on the right shows each step written to the audit trail.

## 3. Deficiency, reply, re-scrutiny (60 s)

1. User **Arjun Wrenfield** (Regional officer) → **My queue** → open **ARG/2026/NR/0055**.
2. **Return with deficiency**: type a reason (it is mandatory), optionally **Draft letter** (labelled
   "Draft, to be reviewed by the officer"; works offline). Return it. The stage card now says
   **AICTE time limit: Paused**.
3. Switch to **Kavya** → open the case → **Reply to deficiency**, attach a PDF, send.
4. Switch back to **Arjun** → **Complete scrutiny**. The case moves **by itself** to **Expert Visit (EVC)**
   and appears in the EVC queue. The route bar shows how many days each stage took and how many were
   waiting on the institution.

## 4. EVC board and a delayed visit (40 s)

- As Arjun → **EVC board** → switch to **All Regions**. **ARG/2026/ER/0017** sits in the red
  **Delayed** column: its visit date passed and it is already escalated to L1.
- **ARG/2026/NR/0032** is in **Due now**: the visit is today.
- Optional: switch to **Prof. Vikram Duskwood** (EVC convenor) → *My cases* → open the visit →
  **Mark visit conducted** → **Submit visit report**.

## 5. Advance the clock: reminders, overdue, escalation (50 s)

- Press **+7d** (now 22 May). The toast reports how many alerts and escalations fired. The bell count
  rises. Ambervale's undertaking got its 1-day reminder on 19 May and its **overdue alert on 21 May**.
- Press **+30d** (now 21 June). The lease got its 7-day reminder, then **expired**, then escalated; the
  undertaking climbed **L1 → L2 → L3**.
- Open **Escalations** (as Arjun or **Ritu Emberly**, Bureau Head): items grouped by level, each showing
  who it went to (Regional Director, Bureau Officer, Bureau Head).
- **Notifications** → *Simulated email / SMS log*: every alert produced an in-app notification plus
  email and SMS rows with delivery status (queued, sent, delivered, failed). Nothing real is sent.

## 6. Evidence, verification, closure (40 s)

1. **Kavya** → **Undertakings** → the overdue undertaking → describe the evidence, upload a file,
   **Submit evidence**.
2. **Arjun** → **Compliance** → *Verification queue* → **Verify**. The undertaking is closed and its
   escalations are resolved on the next check (see *Escalations → Recently resolved*).

## 7. Audit trail (30 s)

**Audit trail** → **Verify audit chain**: "Chain intact: all N entries verified". Click any entry to see
its details, the previous hash and its own hash. Every action, alert, submission, verification,
escalation and closure from this demo is in the list. (The test suite shows that editing or deleting a
past entry makes verification fail at that exact entry.)

## 8. Dashboards, reports and KPIs (40 s)

- **Dashboard** (Arjun or Ritu): overdue, due soon, escalated, cases by stage with the bottleneck,
  time waiting on AICTE vs institutions, Region-wise counts and ageing.
- **Reports**: six reports with Region filter and **Download CSV**; totals match the dashboard.
- **Performance**: all eight KPIs computed live, plus **Run self-test** (one application of each type
  routed through every stage inside a rolled-back transaction).

## Optional extras

- **Dr. Nandini Hazelbrook** (Regional Director) → **ARG/2026/NR/0021** → **Record decision** →
  *Approved with undertakings* → add a condition. Undertakings are created and tracked from that moment.
  An Assistant Director or a committee member cannot record a decision.
- **Dr. Sana Thistledown** (SAC/SHC) → *My cases* → **ARG/2026/WR/0022**: electronic case summary built
  from case facts (Redraft uses Groq if configured, otherwise the offline template) → **Record recommendation**.
- **Ritu Emberly** (Bureau Head) → **Rules and timelines**: change a reminder day or a time limit. It
  applies at once and appears in the audit trail as `rule.changed`.

Other scripted cases: **ARG/2026/SR/0039** returned and waiting on the institution (reply overdue, L1),
**ARG/2026/WR/0043** scrutiny overdue, **ARG/2026/CR/0036** already at **L2**, Rivenmoor College's lease
expired with no renewal, Oakhaven's fire NOC renewal waiting for verification.
