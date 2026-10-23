"use client";

import { useState } from "react";
import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import { StageTimeBars } from "@/components/charts";
import { Button, Card, Collapsible, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Stamp, Table } from "@/components/ui";
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

export default function PerformancePage() {
  const { data, error, loading, reload } = useApi<{ as_of: string; note: string; kpis: Kpi[] }>("/api/kpi");
  const [test, setTest] = useState<SelfTest | null>(null);
  const [running, setRunning] = useState(false);
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const k8 = data.kpis.find((k) => k.id === 8)!;
  const stages = (k8.stages as { stage: string; name: string; completed: number; avg_days: number; avg_institution_days: number; avg_aicte_days: number; on_time_pct: number }[]);

  const runTest = async () => {
    setRunning(true);
    try { setTest(await api<SelfTest>("/api/kpi/routing-selftest", { body: {} })); } catch (e) { toast.error((e as Error).message); }
    setRunning(false);
  };

  return (
    <div>
      <PageHeader title="Performance and KPIs" description={`Measured live from the data as of ${fmtDate(data.as_of)} (simulated). Nothing on this page is typed in by hand.`} />
      <HelpBox id="performance">Targets are <b>our own suggestions</b>, not official requirements. Advance the clock or take actions elsewhere and come back: every number is recomputed.</HelpBox>
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.kpis.filter((k) => k.id !== 8).map((k) => {
          const ok = met(k);
          return (
            <div key={k.id} className="sheet settle flex flex-col px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[12.5px] font-semibold uppercase tracking-[0.05em] text-ink-soft">KPI {k.id} · {k.name}</div>
                {ok === null ? null : ok ? <CheckCircle2 size={18} className="shrink-0 text-olive-ink" aria-label="Target met" /> : <XCircle size={18} className="shrink-0 text-brand" aria-label="Target not met" />}
              </div>
              <div className={`mt-1 font-serif text-[34px] font-semibold leading-none tabular-nums ${ok === false ? "text-brand" : ok ? "text-olive-ink" : "text-ink"}`}>
                {k.value ?? "–"}{k.unit === "%" && k.value !== null ? "%" : ""}
                {k.unit === "items" && <span className="ml-1 text-base font-normal text-ink-soft">missed</span>}
                {k.unit === "follow-ups" && <span className="ml-1 text-base font-normal text-ink-soft">follow-ups</span>}
              </div>
              <div className="mt-1 text-[12.5px] text-ink-soft">Suggested target: {k.target === null ? "shown as a count" : `${k.target}${k.unit === "%" ? "%" : ` ${k.unit}`}`}</div>
              <p className="mt-2 text-[13.5px]">{k.explain}</p>
              <p className="mt-1 text-[12.5px] text-ink-soft">{detail(k)}</p>
            </div>
          );
        })}
        <div className="sheet settle flex flex-col justify-between px-4 py-3.5">
          <div>
            <div className="text-[12.5px] font-semibold uppercase tracking-[0.05em] text-ink-soft">Routing self-test</div>
            <p className="mt-1 text-[13.5px]">Sends one test application of every type through all its stages inside a transaction that is rolled back. No data is kept.</p>
          </div>
          <Button kind="primary" busy={running} onClick={runTest}><FlaskConical size={16} /> Run self-test</Button>
        </div>
      </div>

      {test && (
        <Card title={`Routing self-test: ${test.correct} of ${test.total} correct (${test.value}%)`} subtitle={test.note} pad={false} className="mb-5">
          <Table>
            <thead><tr><th>Application type</th><th>Expected stages</th><th>Visited stages</th><th>Result</th></tr></thead>
            <tbody>{test.results.map((r) => (
              <tr key={r.type}><td>{r.type}</td><td className="text-[13px]">{r.expected.join(" → ")}</td><td className="text-[13px]">{r.visited.join(" → ")}</td>
                <td>{r.correct ? <Stamp tone="closed">Correct</Stamp> : <Stamp tone="overdue">Wrong</Stamp>}</td></tr>
            ))}</tbody>
          </Table>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card title="KPI 8 · Average processing time per stage" subtitle="Completed stages, split by who the case was waiting on">
          <StageTimeBars data={stages} />
        </Card>
        <Card title="Stage detail" pad={false}>
          <Table>
            <thead><tr><th>Stage</th><th className="num">Done</th><th className="num">Avg days</th><th className="num">On time</th></tr></thead>
            <tbody>{stages.map((s) => (
              <tr key={s.stage}><td>{s.name}<div className="text-[12px] text-ink-soft">{s.avg_aicte_days} AICTE · {s.avg_institution_days} institution</div></td>
                <td className="num">{s.completed}</td><td className="num">{s.avg_days}</td><td className="num">{s.on_time_pct}%</td></tr>
            ))}</tbody>
          </Table>
        </Card>
      </div>
      <Card title="How each KPI is measured" className="mt-5">
        <Collapsible title="Show the method">
          <ul className="list-disc space-y-1.5 pl-5 text-[14px]">
            <li><b>Routing accuracy</b>: every application&apos;s stage history is compared with the route fixed when it was submitted.</li>
            <li><b>Alert timeliness</b>: each alert stores the day its rule says it should fire; we compare it with the simulated day it actually fired.</li>
            <li><b>Deadline tracking</b>: a separate query, written independently of the alert engine, lists open items past their due date and checks each has an overdue alert.</li>
            <li><b>Pendency visibility</b>: overdue cases from an independent query must appear both on the official dashboard and in the overdue report.</li>
            <li><b>Escalation coverage</b>: for every overdue item, every level whose day has passed must exist and must have fired on its day.</li>
            <li><b>Audit completeness</b>: alerts, stage changes, decisions, deficiencies, replies, evidence, verifications, uploads, reports and recommendations are matched to audit entries; then the hash chain is verified.</li>
          </ul>
        </Collapsible>
      </Card>
      <NextStep href="/guide" label="guide and demo scenario" />
    </div>
  );
}
