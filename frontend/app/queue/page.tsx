"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { CasePreview } from "@/components/case/CasePreview";
import { SlaBar, rowSla } from "@/components/viz/SlaBar";
import {
  Avatar, Card, DueCell, Empty, ErrorNote, HelpBox, Metrics, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Stat, Table, Tabs,
  useRowNav,
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
  in_review: "Scrutinise", re_review: "Check the reply", awaiting_decision: "Record decision",
  assignment_pending: "Assign EVC members", date_pending: "Fix visit date", report_submitted: "Review visit report",
};

export default function QueuePage() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const { data, error, loading, reload } = useApi<Queue>(user.role === "official" ? "/api/queue" : null);
  const [preview, setPreview] = useState<number | null>(null);
  const [more, setMore] = useState("waiting");
  const mine = useMemo(() => [...(data?.mine ?? [])].sort((a, b) => (a.days_to_due ?? 999) - (b.days_to_due ?? 999)), [data]);
  const open = useCallback((i: number) => setPreview(mine[i]?.id ?? null), [mine]);
  const rowProps = useRowNav(mine.length, open);

  if (user.role !== "official") return <ErrorNote error={{ message: "The work queue is for officials." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const overdue = data.mine.filter((m) => m.sla_status === "overdue").length;
  const toVerify = data.evidence.length + data.renewals.length;
  const maxLoad = Math.max(1, ...data.team.map((t) => t.active));

  return (
    <div>
      <PageHeader crumbs={[{ label: "Cases" }, { label: "My queue" }]} title="My queue" description="Cases waiting for you, and things to verify." />
      <HelpBox id="queue">Take the red items first. Click a row for a quick look.</HelpBox>
      <Metrics>
        <Stat label="My cases" value={data.mine.length} hint="Waiting for your action" />
        <Stat label="Overdue" value={overdue} tone={overdue ? "red" : "good"} hint="Past their time limit" />
        <Stat label="To verify" value={toVerify} tone={toVerify ? "warn" : "ink"} hint="Evidence and renewals" />
      </Metrics>

      <Card title="My cases" subtitle="Nearest deadline first" pad={false} className="mb-6">
        {mine.length ? (
          <Table minWidth={760}>
            <thead><tr><th>Case</th><th>Next step</th><th style={{ width: 160 }}>Time used</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {mine.map((r, i) => {
                const bar = today ? rowSla(r, today) : null;
                return (
                  <tr key={r.id} {...rowProps(i)} aria-label={`Preview ${r.ref_no}`}>
                    <td><span className="mono font-medium text-brand">{r.ref_no}</span><div className="max-w-[260px] truncate text-[12px] text-ink-soft">{r.institution}</div></td>
                    <td className="font-medium">{NEXT[r.substatus] ?? r.substatus_text}<div className="text-[12px] font-normal text-ink-soft">{r.stage_name}</div></td>
                    <td>{bar ? <SlaBar {...bar} compact /> : <span className="text-ink-soft">–</span>}</td>
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
        <Card title="To verify" subtitle="Sent in by institutions" pad={false}>
          {toVerify ? (
            <Table>
              <thead><tr><th>Institution</th><th>Item</th><th /></tr></thead>
              <tbody>
                {data.evidence.map((u) => (
                  <tr key={`u${u.id}`}><td>{u.institution}</td><td className="max-w-[280px]">{u.condition_text}</td>
                    <td><Link href="/compliance" className="text-[13px] font-medium">Verify</Link></td></tr>
                ))}
                {data.renewals.map((d) => (
                  <tr key={`d${d.id}`}><td>{d.institution}</td><td>Renewed {d.title.toLowerCase()}</td>
                    <td><Link href="/validity" className="text-[13px] font-medium">Verify</Link></td></tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="Nothing to verify." />}
        </Card>
        <Card title="Not yet assigned" subtitle="Visits that need committee members" pad={false}>
          {data.unassigned.length ? (
            <Table>
              <thead><tr><th>Case</th><th>Assign by</th></tr></thead>
              <tbody>{data.unassigned.map((u) => (
                <tr key={`${u.application_id}${u.visit_id}`}><td><Link href={`/applications/${u.application_id}`} className="mono font-medium no-underline">{u.ref_no}</Link><div className="text-[12px] text-ink-soft">{u.institution}</div></td>
                  <td className="mono">{fmtDate(u.step_due_at)}</td></tr>
              ))}</tbody>
            </Table>
          ) : <Empty title="Everything is assigned." />}
        </Card>
      </div>

      <Card title={more === "waiting" ? "Waiting on others" : "Team workload"}
        subtitle={more === "waiting" ? "Your cases with the institution or a committee" : "Open cases per officer"}
        action={<Tabs className="whitespace-nowrap" value={more} onChange={setMore} tabs={[{ id: "waiting", label: "Waiting on others" }, { id: "team", label: "Team" }]} />} pad={false}>
        {more === "waiting" ? (data.waiting_on_others.length ? (
          <Table>
            <thead><tr><th>Case</th><th>Waiting for</th><th>Due</th></tr></thead>
            <tbody>{data.waiting_on_others.map((r) => (
              <tr key={r.id}><td><Link href={`/applications/${r.id}`} className="mono font-medium no-underline">{r.ref_no}</Link></td><td>{r.substatus_text}</td>
                <td><DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} /></td></tr>
            ))}</tbody>
          </Table>
        ) : <Empty title="Nothing is waiting on others." />) : (
          <ul className="divide-y divide-line">
            {data.team.map((t) => (
              <li key={t.id} className={`grid grid-cols-[minmax(0,1fr)_140px_70px] items-center gap-3 px-4 py-2.5 ${t.id === user.id ? "bg-brand-tint/60" : ""}`}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={t.name} size={26} />
                  <span className="truncate text-[13.5px] font-medium">{t.name}{t.id === user.id && <span className="ml-1.5 text-[11.5px] font-normal text-brand">you</span>}</span>
                </span>
                <span className="flex items-center gap-2" aria-label={`${t.active} open cases`}>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${(t.active / maxLoad) * 100}%` }} />
                  </span>
                  <span className="mono w-5 text-right text-[13px]">{t.active}</span>
                </span>
                <span className="text-right">{t.overdue ? <Stamp tone="overdue">{t.overdue} late</Stamp> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <CasePreview appId={preview} onClose={() => setPreview(null)} />
      <NextStep href="/applications" label="all applications" />
    </div>
  );
}
