"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { CalendarCheck2, FileSignature, PencilLine } from "lucide-react";
import { VisitStamp } from "@/components/status";
import {
  Card, DueCell, Empty, ErrorNote, HelpBox, Metrics, NextStep, PageHeader, PageSkeleton, Stamp, Stat, Table, useRowNav,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { dueText, fmtDate } from "@/lib/format";
import { RECOMMENDATION_TEXT } from "@/lib/labels";
import { useApp } from "@/lib/store";
import type { Visit } from "@/lib/types";

export { VisitStamp } from "@/components/status";

interface Review {
  id: number; application_id: number; ref_no: string; institution: string; type_name: string; status: string;
  recommendation: string | null; due_at: string; days_to_due: number; likely_delayed?: boolean;
}
interface Cases { visits: Visit[]; reviews: Review[]; counts: { visits_open: number; actions: number; reviews_pending: number } }

export default function CommitteeCases() {
  const user = useApp((s) => s.user)!;
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Cases>("/api/dashboard");
  const visits = data?.visits ?? [];
  const reviews = data?.reviews ?? [];
  const openVisit = useCallback((i: number) => { if (visits[i]) router.push(`/visits/${visits[i].id}`); }, [visits, router]);
  const openReview = useCallback((i: number) => { if (reviews[i]) router.push(`/cases/${reviews[i].application_id}`); }, [reviews, router]);
  const visitRow = useRowNav(visits.length, openVisit);
  const reviewRow = useRowNav(reviews.length, openReview);
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;

  const todo = [
    ...visits.filter((v) => v.my_action).map((v) => ({ key: `v${v.id}`, href: `/visits/${v.id}`, title: v.my_action!, ref: v.ref_no, what: v.institution,
      due: v.step_due_at, days: v.days_to_due, icon: v.my_action!.toLowerCase().includes("report") ? <FileSignature size={15} /> : <CalendarCheck2 size={15} /> })),
    ...reviews.filter((r) => r.status === "pending").map((r) => ({ key: `r${r.id}`, href: `/cases/${r.application_id}`, title: "Record the committee recommendation",
      ref: r.ref_no, what: r.institution, due: r.due_at, days: r.days_to_due as number | null, icon: <PencilLine size={15} /> })),
  ].sort((a, b) => (a.days ?? 999) - (b.days ?? 999));

  return (
    <div>
      <PageHeader crumbs={[{ label: user.committee_kind === "SAC" ? "SAC/SHC member" : "Expert Visit Committee" }, { label: "My cases" }]} title="My cases"
        description="Visits and reviews assigned to you." />
      <HelpBox id="committee">
        Start with <b>What needs you</b>. Your recommendation is advice to the authority, not a decision.
      </HelpBox>
      <Metrics>
        <Stat label="Waiting on you" value={data.counts.actions} tone={data.counts.actions ? "warn" : "good"} hint="Steps that need your input" />
        <Stat label="Open visits" value={data.counts.visits_open} hint="Expert visits you are on" />
        <Stat label="Reviews pending" value={data.counts.reviews_pending} hint="SAC/SHC cases before you" />
      </Metrics>

      <Card title="What needs you" subtitle="Most urgent first" pad={false} className="mb-6">
        {todo.length ? (
          <ul className="divide-y divide-line">
            {todo.map((t) => (
              <li key={t.key}>
                <Link href={t.href} className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-ink no-underline transition-colors hover:bg-surface-2">
                  <span className="mono text-[12.5px] text-ink-soft">{t.due ? fmtDate(t.due).slice(0, 6) : "–"}<span className="block text-[11.5px]">{dueText(t.days)}</span></span>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={`shrink-0 ${t.days != null && t.days < 0 ? "text-danger" : "text-brand"}`}>{t.icon}</span>
                    <span className="min-w-0"><span className="block text-[13.5px] font-medium">{t.title}</span>
                      <span className="block truncate text-[12px] text-ink-soft"><span className="mono">{t.ref}</span> · {t.what}</span></span>
                  </span>
                  {t.days != null && t.days < 0 ? <Stamp tone="overdue" /> : t.days != null && t.days <= 3 ? <Stamp tone="soon">Due soon</Stamp> : <Stamp tone="neutral">Upcoming</Stamp>}
                </Link>
              </li>
            ))}
          </ul>
        ) : <Empty title="Nothing is waiting on you.">Argus reminds you before each step is due.</Empty>}
      </Card>

      {user.committee_kind !== "SAC" || visits.length > 0 ? (
        <Card title="Expert visits" subtitle="Click a row to open it" pad={false} className="mb-6">
          {visits.length ? (
            <Table minWidth={860}>
              <thead><tr><th>Case</th><th>Step</th><th>Visit date</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {visits.map((v, i) => (
                  <tr key={v.id} {...visitRow(i)} aria-label={`Open visit for ${v.ref_no}`}>
                    <td><span className="mono font-medium text-brand">{v.ref_no}</span><div className="text-[12px] text-ink-soft">{v.institution}, {v.city}</div></td>
                    <td>{v.step}{v.my_action && <div className="text-[12px] font-medium text-brand">{v.my_action}</div>}</td>
                    <td className="mono">{v.visit_date ? fmtDate(v.visit_date) : "–"}</td>
                    <td><DueCell date={v.step_due_at} days={v.days_to_due} fmt={fmtDate} /></td>
                    <td><span className="inline-flex flex-wrap items-center gap-1"><VisitStamp v={v} />{v.likely_delayed && <Stamp tone="soon">Likely to be delayed</Stamp>}</span></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="No visits assigned to you.">The Regional office assigns members when a case reaches its EVC stage.</Empty>}
        </Card>
      ) : null}

      {user.committee_kind !== "EVC" || reviews.length > 0 ? (
        <Card title="SAC/SHC reviews" subtitle="Click a row to open it" pad={false}>
          {reviews.length ? (
            <Table>
              <thead><tr><th>Case</th><th>Type</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {reviews.map((r, i) => (
                  <tr key={r.id} {...reviewRow(i)} aria-label={`Open review for ${r.ref_no}`}>
                    <td><span className="mono font-medium text-brand">{r.ref_no}</span><div className="text-[12px] text-ink-soft">{r.institution}</div></td>
                    <td>{r.type_name}</td>
                    <td>{r.status === "pending" ? <DueCell date={r.due_at} days={r.days_to_due} fmt={fmtDate} /> : <span className="text-ink-soft">–</span>}</td>
                    <td><span className="inline-flex flex-wrap items-center gap-1">{r.status === "pending" ? (r.days_to_due < 0 ? <Stamp tone="overdue" solid /> : <Stamp tone="soon">Awaiting you</Stamp>) : <Stamp tone="closed">{RECOMMENDATION_TEXT[r.recommendation ?? ""] ?? "Recorded"}</Stamp>}{r.likely_delayed && <Stamp tone="soon">Likely to be delayed</Stamp>}</span></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="No SAC/SHC reviews assigned to you." />}
        </Card>
      ) : null}
      <NextStep href="/notifications" label="check your notifications" />
    </div>
  );
}
