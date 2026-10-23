"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, DueCell, Empty, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Stamp, Stat, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { EVC_CATEGORY, RECOMMENDATION_TEXT } from "@/lib/labels";
import { useApp } from "@/lib/store";
import type { Visit } from "@/lib/types";

interface Cases {
  visits: Visit[];
  reviews: { id: number; application_id: number; ref_no: string; institution: string; type_name: string; status: string;
    recommendation: string | null; due_at: string; days_to_due: number }[];
  counts: { visits_open: number; actions: number; reviews_pending: number };
}

export function VisitStamp({ v }: { v: Visit }) {
  if (v.escalation_level) return <Stamp tone="escalated" level={v.escalation_level} />;
  if (v.category === "delayed") return <Stamp tone="overdue">Delayed</Stamp>;
  if (v.category === "due") return <Stamp tone="soon">Visit due</Stamp>;
  if (v.category === "completed") return <Stamp tone="closed">Completed</Stamp>;
  return <Stamp tone="neutral">{EVC_CATEGORY[v.category] ?? v.category}</Stamp>;
}

export default function CommitteeCases() {
  const user = useApp((s) => s.user)!;
  const { data, error, loading, reload } = useApi<Cases>("/api/dashboard");
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;

  return (
    <div>
      <PageHeader kicker={user.committee_kind === "SAC" ? "SAC/SHC member" : "Expert Visit Committee"} title="My cases"
        description="Only the visits and reviews assigned to you. Each row says what is waiting on you." />
      <HelpBox id="committee">
        Open a visit to confirm your available dates, mark the visit as conducted and submit the report. Open a SAC/SHC case to read the
        case summary and record the committee&apos;s recommendation. Your recommendation is advice to the competent authority, not a decision.
      </HelpBox>
      <div className="mb-5 grid grid-cols-3 gap-4">
        <Stat label="Waiting on you" value={data.counts.actions} tone={data.counts.actions ? "ochre" : "olive"} />
        <Stat label="Open visits" value={data.counts.visits_open} />
        <Stat label="Reviews pending" value={data.counts.reviews_pending} />
      </div>

      <Card title="Expert visits" subtitle="Visits you are a member of" pad={false} className="mb-5">
        {data.visits.length ? (
          <Table>
            <thead><tr><th>Case</th><th>Current step</th><th>Visit date</th><th>Step due</th><th>Your part</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.visits.map((v) => (
                <tr key={v.id}>
                  <td><Link href={`/visits/${v.id}`} className="font-semibold no-underline">{v.ref_no}</Link><div className="text-[12.5px] text-ink-soft">{v.institution}, {v.city}</div></td>
                  <td>{v.step}</td>
                  <td>{v.visit_date ? fmtDate(v.visit_date) : "–"}</td>
                  <td><DueCell date={v.step_due_at} days={v.days_to_due} fmt={fmtDate} /></td>
                  <td>
                    <div className="text-[13px]">{v.i_am_convenor ? "Convenor" : "Member"}</div>
                    {v.my_action ? <span className="text-[13px] font-semibold text-brand">{v.my_action}</span> : <span className="text-[13px] text-ink-soft">Nothing due</span>}
                  </td>
                  <td><VisitStamp v={v} /></td>
                  <td><Link href={`/visits/${v.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium no-underline">Open <ArrowRight size={14} /></Link></td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="No visits assigned to you." />}
      </Card>

      <Card title="SAC/SHC reviews" subtitle="Cases placed before you" pad={false}>
        {data.reviews.length ? (
          <Table>
            <thead><tr><th>Case</th><th>Type</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.reviews.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/cases/${r.application_id}`} className="font-semibold no-underline">{r.ref_no}</Link><div className="text-[12.5px] text-ink-soft">{r.institution}</div></td>
                  <td>{r.type_name}</td>
                  <td>{r.status === "pending" ? <DueCell date={r.due_at} days={r.days_to_due} fmt={fmtDate} /> : "–"}</td>
                  <td>{r.status === "pending" ? (r.days_to_due < 0 ? <Stamp tone="overdue" /> : <Stamp tone="soon">Awaiting you</Stamp>) : <Stamp tone="closed">{RECOMMENDATION_TEXT[r.recommendation ?? ""] ?? "Recorded"}</Stamp>}</td>
                  <td><Link href={`/cases/${r.application_id}`} className="inline-flex items-center gap-1 text-[13px] font-medium no-underline">Open <ArrowRight size={14} /></Link></td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="No SAC/SHC reviews assigned to you." />}
      </Card>
      <NextStep href="/notifications" label="check your notifications" />
    </div>
  );
}
