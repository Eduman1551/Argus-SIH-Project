"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { CasePreview } from "@/components/case/CasePreview";
import { SlaBar, rowSla, useReminderTicks } from "@/components/viz/SlaBar";
import {
  Avatar, Card, DueCell, Empty, ErrorNote, HelpBox, Metrics, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Stat, Table, useRowNav,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { PendencyRow, TrackedDoc, Undertaking } from "@/lib/types";

interface Queue {
  mine: PendencyRow[]; waiting_on_others: PendencyRow[];
  unassigned: { visit_id: number | null; application_id: number; ref_no: string; institution: string; step_due_at: string }[];
  evidence: Undertaking[]; renewals: TrackedDoc[];
  team: { id: number; name: string; designation: string; active: number; overdue: number }[];
}

const NEXT: Record<string, string> = {
  in_review: "Scrutinise", re_review: "Re-scrutinise the reply", awaiting_decision: "Record decision",
  assignment_pending: "Assign EVC members", date_pending: "Fix visit date", report_submitted: "Review visit report",
};

export default function QueuePage() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const ticks = useReminderTicks();
  const { data, error, loading, reload } = useApi<Queue>(user.role === "official" ? "/api/queue" : null);
  const [preview, setPreview] = useState<number | null>(null);
  const mine = useMemo(() => [...(data?.mine ?? [])].sort((a, b) => (a.days_to_due ?? 999) - (b.days_to_due ?? 999)), [data]);
  const open = useCallback((i: number) => setPreview(mine[i]?.id ?? null), [mine]);
  const rowProps = useRowNav(mine.length, open);

  if (user.role !== "official") return <ErrorNote error={{ message: "The work queue is for officials." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const overdue = data.mine.filter((m) => m.sla_status === "overdue").length;
  const maxLoad = Math.max(1, ...data.team.map((t) => t.active));

  return (
    <div>
      <PageHeader crumbs={[{ label: "Overview" }, { label: "My queue" }]} title="My queue"
        description="Work assigned to you, verification waiting in your Region, and tasks nobody has picked up yet." />
      <HelpBox id="queue">Take the red items first. Click a row for a quick look, or press Enter on it. Reassign from the case page if a colleague has less load.</HelpBox>
      <Metrics>
        <Stat label="My tasks" value={data.mine.length} hint="Cases waiting for your action" />
        <Stat label="My overdue" value={overdue} tone={overdue ? "red" : "olive"} hint="Past their time limit" />
        <Stat label="Evidence to verify" value={data.evidence.length} tone={data.evidence.length ? "ochre" : "ink"} href="/compliance" hint="Undertaking submissions" />
        <Stat label="Renewals to verify" value={data.renewals.length} tone={data.renewals.length ? "ochre" : "ink"} href="/validity" hint="Renewed documents" />
      </Metrics>

      <Card title="My tasks" subtitle="Nearest deadline first. The bar shows time used in the current stage." pad={false} className="mb-6">
        {mine.length ? (
          <Table minWidth={920}>
            <thead><tr><th>Case</th><th>Stage</th><th>Your next step</th><th style={{ width: 180 }}>Time limit</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {mine.map((r, i) => {
                const bar = today ? rowSla(r, today) : null;
                return (
                  <tr key={r.id} {...rowProps(i)} aria-label={`Preview ${r.ref_no}`}>
                    <td><span className="mono font-medium text-brand">{r.ref_no}</span><div className="max-w-[240px] truncate text-[12px] text-ink-soft">{r.institution}</div></td>
                    <td>{r.stage_name}<div className="mono text-[12px] text-ink-soft">day {r.days_in_stage}</div></td>
                    <td className="font-medium">{NEXT[r.substatus] ?? r.substatus_text}</td>
                    <td>{bar ? <SlaBar {...bar} ticks={ticks.stage} compact /> : <span className="text-ink-soft">–</span>}</td>
                    <td><DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} /></td>
                    <td><SlaStamp status={r.sla_status} days={r.days_to_due} level={r.escalation_level} solid /></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : <Empty title="Your queue is clear.">New cases are assigned by workload as they arrive.</Empty>}
      </Card>

      <div className="mb-6 grid items-start gap-5 xl:grid-cols-2">
        <Card title="Evidence and renewals to verify" subtitle="Submitted by institutions in your Region" pad={false}>
          {data.evidence.length + data.renewals.length ? (
            <Table>
              <thead><tr><th>Institution</th><th>Item</th><th>Submitted</th><th /></tr></thead>
              <tbody>
                {data.evidence.map((u) => (
                  <tr key={`u${u.id}`}><td>{u.institution}</td><td className="max-w-[280px]"><span className="text-ink-soft">Undertaking:</span> {u.condition_text}</td>
                    <td className="mono">{fmtDate(u.last_submission?.submitted_at)}</td><td><Link href="/compliance" className="text-[13px] font-medium">Verify</Link></td></tr>
                ))}
                {data.renewals.map((d) => (
                  <tr key={`d${d.id}`}><td>{d.institution}</td><td><span className="text-ink-soft">Renewed:</span> {d.title}</td>
                    <td className="mono">{fmtDate(d.renewal_submitted_at)}</td><td><Link href="/validity" className="text-[13px] font-medium">Verify</Link></td></tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="Nothing to verify.">Submissions from institutions appear here.</Empty>}
        </Card>
        <Card title="Unassigned tasks" subtitle="Visits that still need committee members" pad={false}>
          {data.unassigned.length ? (
            <Table>
              <thead><tr><th>Case</th><th>Task</th><th>Assign by</th></tr></thead>
              <tbody>{data.unassigned.map((u) => (
                <tr key={`${u.application_id}${u.visit_id}`}><td><Link href={`/applications/${u.application_id}`} className="mono font-medium no-underline">{u.ref_no}</Link><div className="text-[12px] text-ink-soft">{u.institution}</div></td>
                  <td>{u.visit_id ? "Assign EVC members" : "Assign an officer"}</td><td className="mono">{fmtDate(u.step_due_at)}</td></tr>
              ))}</tbody>
            </Table>
          ) : <Empty title="Everything is assigned." />}
        </Card>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card title="Team workload" subtitle="Active stages per officer" pad={false}>
          <ul className="divide-y divide-line">
            {data.team.map((t) => (
              <li key={t.id} className={`grid grid-cols-[minmax(0,1fr)_120px_70px] items-center gap-3 px-4 py-2.5 ${t.id === user.id ? "bg-brand-tint/60" : ""}`}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={t.name} size={26} />
                  <span className="min-w-0"><span className="block truncate text-[13.5px] font-medium">{t.name}{t.id === user.id && <span className="ml-1.5 text-[11.5px] font-normal text-brand">you</span>}</span>
                    <span className="block truncate text-[12px] text-ink-soft">{t.designation}</span></span>
                </span>
                <span className="flex items-center gap-2" aria-label={`${t.active} active`}>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${(t.active / maxLoad) * 100}%` }} />
                  </span>
                  <span className="mono w-5 text-right text-[13px]">{t.active}</span>
                </span>
                <span className="text-right">{t.overdue ? <Stamp tone="overdue">{t.overdue}</Stamp> : <span className="mono text-[12px] text-ink-soft">0 late</span>}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Assigned to me, waiting on others" subtitle="Institution replies and committee steps on my cases" pad={false}>
          {data.waiting_on_others.length ? (
            <Table>
              <thead><tr><th>Case</th><th>Waiting for</th><th>Due</th></tr></thead>
              <tbody>{data.waiting_on_others.map((r) => (
                <tr key={r.id}><td><Link href={`/applications/${r.id}`} className="mono font-medium no-underline">{r.ref_no}</Link></td><td>{r.substatus_text}</td>
                  <td><DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} /></td></tr>
              ))}</tbody>
            </Table>
          ) : <Empty title="Nothing is waiting on others." />}
        </Card>
      </div>
      <CasePreview appId={preview} onClose={() => setPreview(null)} />
      <NextStep href="/applications" label="all applications" />
    </div>
  );
}
