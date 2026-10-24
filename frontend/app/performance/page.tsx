"use client";

import { useState } from "react";
import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import { StageTimeBars } from "@/components/charts";
import {
  Button, Card, Collapsible, DocLayout, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Section, Stamp, Table,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { toast } from "@/lib/store";

interface Kpi {
  id: number; name: string; explain: string; value: number | null; target: number | null; unit: string; checked?: number;
  [k: string]: unknown;
}
interface SelfTest { results: { type: string; route: string; expected: string[]; visited: string[]; correct: boolean }[]; correct: number; total: number; value: number; note: string }

function met(k: Kpi) {
  if (k.target === null || k.value === null) return null;
  return k.unit === "items" ? Number(k.value) <= Number(k.target) : Number(k.value) >= Number(k.target);
}

function detail(k: Kpi): string {
  switch (k.id) {
    case 1: return `${k.checked} applications checked against their routes.`;
    case 2: return `${k.on_time} of ${k.checked} alerts fired on their exact day; ${k.late} late.`;
    case 3: return `${k.checked} open items are past due; ${(k.missed as string[]).length} were not flagged.`;
    case 4: return `${k.visible} of ${k.checked} overdue cases appear on both the dashboard and the overdue report.`;
    case 5: return `${k.reminders} reminders, ${k.overdue_alerts} overdue alerts and ${k.escalations} escalations; ${k.messages} simulated messages. Assumes ${k.assumed_per_alert} manual follow-up per alert.`;
    case 6: return `${k.correct} of ${k.checked} overdue items reached every due level on the right day.`;
    case 7: return `${k.audited} of ${k.checked} records have an audit entry. Chain ${k.chain_valid ? "valid" : "BROKEN"} across ${k.chain_entries} entries.`;
    default: return "";
  }
}

const UNIT_TEXT: Record<string, string> = { items: "missed", "follow-ups": "follow-ups" };

const TOC = [
  { id: "results", label: "Results" },
  { id: "selftest", label: "Routing self-test" },
  { id: "stage-time", label: "Time per stage" },
  { id: "intelligence", label: "Intelligence results" },
  { id: "method", label: "How it is measured" },
];

export default function PerformancePage() {
  const { data, error, loading, reload } = useApi<{ as_of: string; note: string; kpis: Kpi[] }>("/api/kpi");
  const intel = useApi<IntelMetrics>("/api/intelligence/metrics");
  const [test, setTest] = useState<SelfTest | null>(null);
  const [running, setRunning] = useState(false);
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const k8 = data.kpis.find((k) => k.id === 8)!;
  const stages = (k8.stages as { stage: string; name: string; completed: number; avg_days: number; avg_institution_days: number; avg_aicte_days: number; on_time_pct: number }[]);
  const scored = data.kpis.filter((k) => k.id !== 8);
  const passing = scored.filter((k) => met(k) === true).length;
  const withTarget = scored.filter((k) => met(k) !== null).length;

  const runTest = async () => {
    setRunning(true);
    try { setTest(await api<SelfTest>("/api/kpi/routing-selftest", { body: {} })); } catch (e) { toast.error((e as Error).message); }
    setRunning(false);
  };

  return (
    <div>
      <PageHeader crumbs={[{ label: "Reports" }, { label: "Performance" }]} title="Performance"
        description={<>How well Argus keeps deadlines, measured from the data on <span className="mono">{fmtDate(data.as_of)}</span>.</>}
        action={<Button kind="primary" busy={running} onClick={runTest}><FlaskConical size={15} /> Run routing self-test</Button>} />
      <HelpBox id="performance">Targets are our own suggestions, not official requirements.</HelpBox>

      <DocLayout toc={TOC}>
        <div className="space-y-9">
        <Section id="results" title="Results" description={`${passing} of ${withTarget} KPIs with a target meet it right now.`}>
          <div className="grid gap-4 md:grid-cols-2">
            {scored.map((k) => {
              const ok = met(k);
              return (
                <div key={k.id} className="surface enter flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[12.5px] font-medium text-ink-soft"><span className="mono">KPI {k.id}</span> · {k.name}</div>
                    {ok === null ? <Stamp tone="neutral">Count</Stamp> : ok
                      ? <span className="inline-flex items-center gap-1 text-[12px] font-medium text-brand"><CheckCircle2 size={15} aria-hidden /> Target met</span>
                      : <span className="inline-flex items-center gap-1 text-[12px] font-medium text-danger-ink"><XCircle size={15} aria-hidden /> Below target</span>}
                  </div>
                  <div className={`mono mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] ${ok === false ? "text-danger-ink" : ok ? "text-brand" : "text-ink"}`}>
                    {k.value ?? "–"}{k.unit === "%" && k.value !== null ? "%" : ""}
                    {UNIT_TEXT[k.unit] && <span className="ml-1.5 font-sans text-[14px] font-normal tracking-normal text-ink-soft">{UNIT_TEXT[k.unit]}</span>}
                  </div>
                  <div className="mt-1.5 text-[12px] text-ink-soft">Suggested target: <span className="mono">{k.target === null ? "shown as a count" : `${k.target}${k.unit === "%" ? "%" : ` ${k.unit}`}`}</span></div>
                  <p className="mt-3 border-t border-line pt-3 text-[13.5px]">{k.explain}</p>
                  <p className="mt-1 text-[12px] text-ink-soft">{detail(k)}</p>
                </div>
              );
            })}
          </div>
        </Section>

        <Section id="selftest" title="Routing self-test"
          description="Sends one test application of every type through all its stages inside a transaction that is rolled back. No data is kept.">
          {test ? (
            <Card title={<>Result: <span className="mono">{test.correct}</span> of <span className="mono">{test.total}</span> correct (<span className="mono">{test.value}%</span>)</>} subtitle={test.note} pad={false}>
              <Table minWidth={760}>
                <thead><tr><th>Application type</th><th>Expected stages</th><th>Visited stages</th><th>Result</th></tr></thead>
                <tbody>{test.results.map((r) => (
                  <tr key={r.type}><td>{r.type}</td><td className="text-[12.5px]">{r.expected.join(" → ")}</td><td className="text-[12.5px]">{r.visited.join(" → ")}</td>
                    <td>{r.correct ? <Stamp tone="closed">Correct</Stamp> : <Stamp tone="overdue">Wrong</Stamp>}</td></tr>
                ))}</tbody>
              </Table>
            </Card>
          ) : (
            <div className="surface flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-[13.5px] text-ink-soft">Not run yet in this session. The result feeds KPI 1 for new application types.</p>
              <Button busy={running} onClick={runTest}><FlaskConical size={15} /> Run self-test</Button>
            </div>
          )}
        </Section>

        <Section id="stage-time" title="KPI 8 · Average processing time per stage" description="Completed stages, split by who the case was waiting on.">
          <div className="grid items-start gap-5 2xl:grid-cols-[1.3fr_1fr]">
            <Card><StageTimeBars data={stages} /></Card>
            <Card pad={false}>
              <Table>
                <thead><tr><th>Stage</th><th className="num">Done</th><th className="num">Avg days</th><th className="num">On time</th></tr></thead>
                <tbody>{stages.map((s) => (
                  <tr key={s.stage}><td>{s.name}<div className="text-[12px] text-ink-soft"><span className="mono">{s.avg_aicte_days}</span> AICTE · <span className="mono">{s.avg_institution_days}</span> institution</div></td>
                    <td className="num mono">{s.completed}</td><td className="num mono">{s.avg_days}</td><td className="num mono">{s.on_time_pct}%</td></tr>
                ))}</tbody>
              </Table>
            </Card>
          </div>
        </Section>

        <Section id="intelligence" title="Intelligence results"
          description="How well the delay-risk predictions and the recommended actions work, measured on the synthetic history.">
          {intel.data ? <IntelResults m={intel.data} /> : <div className="skeleton h-[120px]" />}
        </Section>

        <Section id="method" title="How each KPI is measured">
          <div className="surface px-4 py-2">
            <Collapsible title="Show the method">
            <dl className="divide-y divide-line text-[13.5px]">
              {[
                ["Routing accuracy", "Every application's stage history is compared with the route fixed when it was submitted."],
                ["Alert timeliness", "Each alert stores the day its rule says it should fire; that is compared with the simulated day it actually fired."],
                ["Deadline tracking", "A separate query, written independently of the alert engine, lists open items past their due date and checks each has an overdue alert."],
                ["Pendency visibility", "Overdue cases from an independent query must appear both on the official dashboard and in the overdue report."],
                ["Escalation coverage", "For every overdue item, every level whose day has passed must exist and must have fired on its day."],
                ["Audit completeness", "Alerts, stage changes, decisions, deficiencies, replies, evidence, verifications, uploads, reports and recommendations are matched to audit entries; then the hash chain is verified."],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="font-medium">{k}</dt><dd className="text-ink-soft">{v}</dd></div>
              ))}
            </dl>
            </Collapsible>
          </div>
        </Section>
        </div>
      </DocLayout>
      <NextStep href="/guide" label="guide and demo scenario" />
    </div>
  );
}

interface IntelMetrics {
  interventions: { approved: number; dismissed: number; open: number; measured: number; succeeded: number;
    success_rate: number | null; avg_days_saved: number | null };
  backtest: { cases: number; late: number; predicted_high: number; true_positive: number; false_positive: number;
    false_negative: number; true_negative: number; accuracy: number | null; false_alert_rate: number | null;
    late_caught: number | null };
  note: string;
}

function IntelResults({ m }: { m: IntelMetrics }) {
  const i = m.interventions;
  const b = m.backtest;
  const show = (v: number | null, unit = "%") => (v == null ? "–" : `${v}${unit}`);
  return (
    <div className="surface p-4">
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Intervention success", show(i.success_rate), `${i.succeeded} of ${i.measured} measured actions lowered the risk or finished on time`],
          ["Average days saved", show(i.avg_days_saved, " days"), "Projected delay before the action minus the delay measured after"],
          ["Prediction accuracy", show(b.accuracy), `${b.true_positive + b.true_negative} of ${b.cases} cases with a known outcome predicted correctly`],
          ["False-alert rate", show(b.false_alert_rate), `${b.false_positive} of ${b.predicted_high} High warnings finished on time`],
        ].map(([label, value, hint]) => (
          <div key={label}>
            <dt className="text-[12px] font-medium text-ink-soft">{label}</dt>
            <dd className="mono mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em]">{value}</dd>
            <dd className="mt-1.5 text-[12px] text-ink-soft">{hint}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-line pt-3 text-[12px] text-ink-soft">
        {m.note} Late cases caught early: {show(b.late_caught)}. Recommendations so far: {i.approved} approved, {i.dismissed} dismissed,
        {" "}{i.open} open.
      </p>
    </div>
  );
}
