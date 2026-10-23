"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Flag } from "lucide-react";
import { AgeingBars, RegionBars, SplitBar, StageBars } from "@/components/charts";
import { Card, DueCell, Empty, ErrorNote, HelpBox, LinkButton, NextStep, PageHeader, PageSkeleton, SlaStamp, Stat, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { OfficialDashboard as Dash, PendencyRow } from "@/lib/types";

function CaseRows({ rows, empty }: { rows: PendencyRow[]; empty: string }) {
  const router = useRouter();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Table>
      <thead><tr><th>Case</th><th>Where it is</th><th>Due</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="row-link" onClick={() => router.push(`/applications/${r.id}`)}>
            <td>
              <Link href={`/applications/${r.id}`} className="font-semibold no-underline">{r.ref_no}</Link>
              <div className="max-w-[230px] truncate text-[12.5px] text-ink-soft">{r.institution}</div>
            </td>
            <td><div className="whitespace-nowrap">{r.stage_name}</div><div className="text-[12.5px] text-ink-soft">{r.substatus_text}</div></td>
            <td>
              <DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} />
              <div className="mt-1"><SlaStamp status={r.sla_status} days={r.days_to_due} level={r.escalation_level} waitingOn={r.waiting_on} /></div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default function OfficialDashboard() {
  const user = useApp((s) => s.user)!;
  const regional = user.official_kind === "regional";
  const [all, setAll] = useState(!regional);
  const { data, error, loading, reload } = useApi<Dash>(`/api/dashboard${all ? "?all_regions=true" : ""}`);

  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const t = data.totals;
  const c = data.compliance;

  return (
    <div>
      <PageHeader
        kicker={data.scope}
        title="Pendency dashboard"
        description="Where every application stands, how long it has waited, and what is about to slip or already has."
        action={regional ? (
          <div className="inline-flex rounded-md border border-line bg-card p-0.5 text-[13px]" role="group" aria-label="Scope">
            <button onClick={() => setAll(false)} className={`rounded px-3 py-1.5 ${!all ? "bg-brand text-white" : "text-ink"}`}>My Region</button>
            <button onClick={() => setAll(true)} className={`rounded px-3 py-1.5 ${all ? "bg-brand text-white" : "text-ink"}`}>All Regions</button>
          </div>
        ) : undefined}
      />
      <HelpBox id="dashboard">
        Start with the red numbers. <b>Overdue</b> cases are past their time limit; <b>Escalated</b> ones have gone up the chain.
        Click any case to act on it. Use <b>+7d</b> in the top bar to see what happens next week.
      </HelpBox>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Cases in progress" value={t.cases} hint={`Average age ${data.avg_age_days} days`} href="/applications?status=in_progress" />
        <Stat label="Overdue" value={t.overdue} tone="red" hint="Past their time limit" href="/applications?sla=overdue" />
        <Stat label="Due soon" value={t.due_soon} tone="ochre" hint="Within the due-soon window" href="/applications?sla=due_soon" />
        <Stat label="Escalated" value={t.escalated} tone="red" hint={`L1 ${data.escalations_by_level["1"] ?? 0} · L2 ${data.escalations_by_level["2"] ?? 0} · L3 ${data.escalations_by_level["3"] ?? 0} (all items)`} href="/escalations" />
        <Stat label="With institution" value={t.waiting_on_institution} hint="Deficiency replies awaited" href="/applications" />
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Cases by stage" subtitle="Red part of each bar is overdue">
          <StageBars data={data.by_stage} />
          {data.bottleneck && data.bottleneck.cases > 0 && (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-brand-tint/60 px-3 py-2 text-[13.5px] text-brand-deep">
              <AlertTriangle size={15} /> Bottleneck: <b>{data.bottleneck.name}</b>, {data.bottleneck.overdue} overdue, average {data.bottleneck.avg_days_in_stage} days in stage.
            </div>
          )}
        </Card>
        <Card title="Who is the case waiting on?" subtitle="Total days across all cases in progress">
          <SplitBar institution={t.institution_days} aicte={t.aicte_days} />
          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-md border border-line bg-paper/60 p-3">
              <div className="font-serif text-2xl font-semibold">{data.avg_aicte_days}</div>
              <div className="text-[12.5px] text-ink-soft">avg days with AICTE and committees</div>
            </div>
            <div className="rounded-md border border-line bg-paper/60 p-3">
              <div className="font-serif text-2xl font-semibold">{data.avg_institution_days}</div>
              <div className="text-[12.5px] text-ink-soft">avg days waiting on institutions</div>
            </div>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-soft">The AICTE time limit pauses while a deficiency reply is awaited, so institution time is never counted against officers.</p>
        </Card>
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <Card title="Overdue cases" subtitle={`${data.overdue_list.length} case(s), most late first`} pad={false}
          action={<LinkButton small href="/reports?r=overdue">Overdue report</LinkButton>}>
          <div className="max-h-[360px] overflow-y-auto scroll-thin"><CaseRows rows={data.overdue_list} empty="Nothing is overdue." /></div>
        </Card>
        <Card title="Near deadline" subtitle="Due within the next few days" pad={false}>
          <div className="max-h-[360px] overflow-y-auto scroll-thin"><CaseRows rows={data.near_deadline} empty="No case is close to its deadline." /></div>
        </Card>
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-3">
        <Card title="Regions" subtitle="Cases in progress, overdue in red">
          <RegionBars data={data.by_region} />
        </Card>
        <Card title="Ageing" subtitle="Days since submission">
          <AgeingBars data={data.ageing} />
        </Card>
        <Card title="Compliance watch" subtitle="Undertakings, documents and visits">
          <ul className="space-y-2 text-[14px]">
            {[
              ["Undertakings overdue", c.undertakings_overdue, "/compliance", true],
              ["Evidence waiting for verification", c.evidence_waiting, "/compliance", false],
              ["Documents expired", c.documents_expired, "/validity", true],
              ["Documents expiring soon", c.documents_expiring, "/validity", false],
              ["Renewals waiting for verification", c.renewals_waiting, "/validity", false],
              ["EVC visits delayed", c.evc_delayed, "/evc", true],
              ["EVC visits due now", c.evc_due, "/evc", false],
            ].map(([label, n, href, bad]) => (
              <li key={label as string}>
                <Link href={href as string} className="flex items-center justify-between rounded-md px-2 py-1.5 text-ink no-underline hover:bg-paper-2">
                  <span className="flex items-center gap-2">{bad && (n as number) > 0 ? <Flag size={14} className="text-brand" /> : <span className="w-[14px]" />}{label}</span>
                  <span className={`font-serif text-lg font-semibold tabular-nums ${bad && (n as number) > 0 ? "text-brand" : ""}`}>{n as number}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Unassigned tasks" subtitle="Visits waiting for committee members, and stages without an officer" pad={false}>
        {data.unassigned.length ? (
          <Table>
            <thead><tr><th>Case</th><th>Institution</th><th>Task</th><th>Assign by</th></tr></thead>
            <tbody>
              {data.unassigned.map((u) => (
                <tr key={`${u.application_id}-${u.visit_id}`}>
                  <td><Link href={`/applications/${u.application_id}`} className="font-semibold no-underline">{u.ref_no}</Link></td>
                  <td>{u.institution}</td>
                  <td>{u.visit_id ? "Assign EVC members" : "Assign an officer"}</td>
                  <td>{fmtDate(u.step_due_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="Everything is assigned." />}
      </Card>

      <NextStep href="/queue" label="open my queue" />
    </div>
  );
}
