"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Card, DueCell, Empty, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Stat, Table } from "@/components/ui";
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
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Queue>(user.role === "official" ? "/api/queue" : null);
  if (user.role !== "official") return <ErrorNote error={{ message: "The work queue is for officials." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const overdue = data.mine.filter((m) => m.sla_status === "overdue").length;

  return (
    <div>
      <PageHeader title="My queue" description="Work assigned to you, verification waiting in your Region, and tasks nobody has picked up yet." />
      <HelpBox id="queue">Take the red items first. Opening a case shows exactly which actions you can take on it. Reassign from the case page if a colleague has less load.</HelpBox>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="My tasks" value={data.mine.length} />
        <Stat label="My overdue" value={overdue} tone={overdue ? "red" : "olive"} />
        <Stat label="Evidence to verify" value={data.evidence.length} tone={data.evidence.length ? "ochre" : "ink"} href="/compliance" />
        <Stat label="Renewals to verify" value={data.renewals.length} tone={data.renewals.length ? "ochre" : "ink"} href="/validity" />
      </div>

      <Card title="My tasks" subtitle="Cases waiting for your action, oldest deadline first" pad={false} className="mb-5">
        {data.mine.length ? (
          <Table minWidth={900}>
            <thead><tr><th>Case</th><th>Stage</th><th>Your next step</th><th className="num">Days in stage</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {[...data.mine].sort((a, b) => (a.days_to_due ?? 999) - (b.days_to_due ?? 999)).map((r) => (
                <tr key={r.id} className="row-link" onClick={() => router.push(`/applications/${r.id}`)}>
                  <td><Link href={`/applications/${r.id}`} className="font-semibold no-underline">{r.ref_no}</Link><div className="text-[12.5px] text-ink-soft">{r.institution}</div></td>
                  <td>{r.stage_name}</td>
                  <td className="font-medium">{NEXT[r.substatus] ?? r.substatus_text}</td>
                  <td className="num">{r.days_in_stage}</td>
                  <td><DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} /></td>
                  <td><SlaStamp status={r.sla_status} days={r.days_to_due} level={r.escalation_level} /></td>
                  <td><ArrowRight size={16} className="text-ink-soft" /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="Your queue is clear.">New cases are assigned by workload as they arrive.</Empty>}
      </Card>

      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <Card title="Evidence and renewals to verify" subtitle="Submitted by institutions in your Region" pad={false}>
          {data.evidence.length + data.renewals.length ? (
            <Table>
              <thead><tr><th>Institution</th><th>Item</th><th>Submitted</th><th /></tr></thead>
              <tbody>
                {data.evidence.map((u) => (
                  <tr key={`u${u.id}`}><td>{u.institution}</td><td className="max-w-[280px]">Undertaking: {u.condition_text}</td>
                    <td>{fmtDate(u.last_submission?.submitted_at)}</td><td><Link href="/compliance" className="text-[13px]">Verify</Link></td></tr>
                ))}
                {data.renewals.map((d) => (
                  <tr key={`d${d.id}`}><td>{d.institution}</td><td>Renewed {d.title}</td>
                    <td>{fmtDate(d.renewal_submitted_at)}</td><td><Link href="/validity" className="text-[13px]">Verify</Link></td></tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="Nothing to verify." />}
        </Card>
        <Card title="Unassigned tasks" subtitle="Visits that still need committee members" pad={false}>
          {data.unassigned.length ? (
            <Table>
              <thead><tr><th>Case</th><th>Task</th><th>Assign by</th></tr></thead>
              <tbody>{data.unassigned.map((u) => (
                <tr key={`${u.application_id}${u.visit_id}`}><td><Link href={`/applications/${u.application_id}`} className="font-semibold no-underline">{u.ref_no}</Link><div className="text-[12.5px] text-ink-soft">{u.institution}</div></td>
                  <td>{u.visit_id ? "Assign EVC members" : "Assign an officer"}</td><td>{fmtDate(u.step_due_at)}</td></tr>
              ))}</tbody>
            </Table>
          ) : <Empty title="Everything is assigned." />}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Team workload" subtitle="Active stages per officer" pad={false}>
          <Table>
            <thead><tr><th>Officer</th><th className="num">Active</th><th className="num">Overdue</th></tr></thead>
            <tbody>{data.team.map((t) => (
              <tr key={t.id} className={t.id === user.id ? "selected" : ""}><td><b>{t.name}</b><div className="text-[12.5px] text-ink-soft">{t.designation}</div></td>
                <td className="num">{t.active}</td><td className="num">{t.overdue ? <Stamp tone="overdue">{t.overdue}</Stamp> : 0}</td></tr>
            ))}</tbody>
          </Table>
        </Card>
        <Card title="Assigned to me, waiting on others" subtitle="Institution replies and committee steps on my cases" pad={false}>
          {data.waiting_on_others.length ? (
            <Table>
              <thead><tr><th>Case</th><th>Waiting for</th><th>Due</th></tr></thead>
              <tbody>{data.waiting_on_others.map((r) => (
                <tr key={r.id}><td><Link href={`/applications/${r.id}`} className="font-semibold no-underline">{r.ref_no}</Link></td><td>{r.substatus_text}</td>
                  <td><DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} /></td></tr>
              ))}</tbody>
            </Table>
          ) : <Empty title="Nothing is waiting on others." />}
        </Card>
      </div>
      <NextStep href="/applications" label="all applications" />
    </div>
  );
}
