"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Flag, ListTodo, MapPin } from "lucide-react";
import { AgeingBars, SplitBar } from "@/components/charts";
import { CasePreview } from "@/components/case/CasePreview";
import { HeatCalendar, type CalEvent } from "@/components/viz/HeatCalendar";
import { ProcessLine, STATIONS, stationOf, type StationId } from "@/components/viz/ProcessLine";
import { RegionTiles, type RegionStat } from "@/components/viz/RegionTiles";
import { SlaBar, rowSla } from "@/components/viz/SlaBar";
import {
  Card, DueCell, Empty, ErrorNote, FilterChips, HelpBox, LinkButton, Metrics, NextStep, Owner, PageHeader, PageSkeleton, SlaStamp,
  Stat, Table, Tabs, useRowNav,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { OfficialDashboard as Dash, PendencyRow, TrackedDoc, Undertaking, Visit } from "@/lib/types";

const LIST_MAX = 10;

export default function OfficialDashboard() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const [region, setRegion] = useState<number | null>(user.official_kind === "regional" ? user.region_id : null);
  const [station, setStation] = useState<StationId | null>(null);
  const [metric, setMetric] = useState<"cases" | "overdue">("cases");
  const [preview, setPreview] = useState<number | null>(null);

  const { data, error, loading, reload } = useApi<Dash>(`/api/dashboard${region ? `?region_id=${region}` : "?all_regions=true"}`);
  const pend = useApi<{ rows: PendencyRow[] }>("/api/reports/pendency");
  const regions = useApi<{ id: number; code: string; name: string }[]>("/api/regions");
  const unds = useApi<{ rows: Undertaking[] }>("/api/undertakings?all_regions=true");
  const docs = useApi<{ rows: TrackedDoc[] }>("/api/tracked-documents?all_regions=true");
  const evc = useApi<{ visits: Visit[] }>("/api/evc/board?all_regions=true");

  const regionName = regions.data?.find((r) => r.id === region)?.name ?? null;
  const allRows = useMemo(() => pend.data?.rows ?? [], [pend.data]);
  const scoped = useMemo(() => allRows.filter((r) => region == null || r.region_id === region), [allRows, region]);
  const listed = useMemo(() => scoped.filter((r) => station == null || stationOf(r) === station)
    .sort((a, b) => (a.days_to_due ?? 999) - (b.days_to_due ?? 999)), [scoped, station]);

  const tiles = useMemo<RegionStat[]>(() => (regions.data ?? []).map((g) => ({
    region_id: g.id, code: g.code, region: g.name,
    cases: allRows.filter((r) => r.region_id === g.id).length,
    overdue: allRows.filter((r) => r.region_id === g.id && r.sla_status === "overdue").length,
  })), [regions.data, allRows]);

  const events = useMemo<CalEvent[]>(() => {
    const inScope = (name: string) => regionName == null || name === regionName;
    return [
      ...(unds.data?.rows ?? []).filter((u) => u.state !== "closed" && inScope(u.region))
        .map((u) => ({ date: u.due_date, kind: "undertaking" as const, label: `${u.institution}: ${u.condition_text}`, href: "/compliance" })),
      ...(docs.data?.rows ?? []).filter((d) => d.status !== "renewal_submitted" && inScope(d.region))
        .map((d) => ({ date: d.expires_on, kind: "document" as const, label: `${d.institution}: ${d.title}`, href: "/validity" })),
      ...(evc.data?.visits ?? []).filter((v) => v.visit_date && v.status !== "reviewed" && (region == null || v.region_id === region))
        .map((v) => ({ date: v.visit_date!, kind: "evc" as const, label: `Visit for ${v.ref_no}`, href: `/applications/${v.application_id}` })),
    ];
  }, [unds.data, docs.data, evc.data, region, regionName]);

  const shown = listed.slice(0, LIST_MAX);
  const open = useCallback((i: number) => setPreview(shown[i]?.id ?? null), [shown]);
  const rowProps = useRowNav(shown.length, open);

  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const t = data.totals;
  const c = data.compliance;
  const stationLabel = STATIONS.find((s) => s.id === station)?.label;

  const chips = [
    ...(region != null ? [{ key: "r", label: <><MapPin size={12} /> {regionName ?? "Region"}</>, onRemove: () => setRegion(null) }] : []),
    ...(station ? [{ key: "s", label: `At ${stationLabel}`, onRemove: () => setStation(null) }] : []),
  ];

  return (
    <div>
      <PageHeader crumbs={[{ label: "Overview" }, { label: "Dashboard" }]} title="Pendency dashboard"
        description={<>Where every application stands, how long it has waited, and what is about to slip. Showing <b className="font-medium text-ink">{data.scope}</b>.</>}
        action={<LinkButton kind="primary" href="/queue"><ListTodo size={15} /> Open my queue</LinkButton>} />
      <HelpBox id="dashboard">
        Start with the red numbers. Click a <b>stage</b> on the process line to list the cases sitting there, or a <b>Region</b> tile to
        scope the whole page. Advance the clock from the date chip in the top bar to see what happens next week.
      </HelpBox>

      <Metrics>
        <Stat label="Cases in progress" value={t.cases} hint={`Average age ${data.avg_age_days} days`} href="/applications?status=in_progress" />
        <Stat label="Overdue" value={t.overdue} tone={t.overdue ? "red" : "good"} hint="Past their time limit" href="/applications?sla=overdue" />
        <Stat label="Due soon" value={t.due_soon} tone={t.due_soon ? "warn" : "ink"} hint="Inside the due-soon window" href="/applications?sla=due_soon" />
        <Stat label="Escalated" value={t.escalated} tone={t.escalated ? "red" : "ink"}
          hint={<span className="mono">L1 {data.escalations_by_level["1"] ?? 0} · L2 {data.escalations_by_level["2"] ?? 0} · L3 {data.escalations_by_level["3"] ?? 0}</span>} href="/escalations" />
        <Stat label="With institutions" value={t.waiting_on_institution} hint="Deficiency replies awaited" href="/applications" />
      </Metrics>

      <Card title="Process line" subtitle="Cases in progress at each step of the journey. Click a step to list its cases." className="mb-6"
        action={data.bottleneck && data.bottleneck.cases > 0 ? (
          <span className="hidden items-center gap-1.5 rounded-full bg-warn-tint px-2.5 py-1 text-[12px] text-warn-ink md:inline-flex">
            <AlertTriangle size={13} /><span>Bottleneck: <b className="font-medium">{data.bottleneck.name}</b>, avg <span className="mono">{data.bottleneck.avg_days_in_stage}</span> days in stage</span>
          </span>) : undefined}>
        {pend.data ? <ProcessLine rows={scoped} value={station} onChange={setStation} /> : <div className="skeleton h-[170px]" />}
        <div className="mt-5">
          <FilterChips chips={chips} onClear={() => { setRegion(null); setStation(null); }} />
          {shown.length ? (
            <div className="overflow-hidden rounded-xl border border-line">
              <Table minWidth={860}>
                <thead><tr><th>Case</th><th>Stage</th><th>With</th><th style={{ width: 170 }}>Time limit</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {shown.map((r, i) => {
                    const bar = today ? rowSla(r, today) : null;
                    return (
                      <tr key={r.id} {...rowProps(i)} aria-label={`Preview ${r.ref_no}`}>
                        <td><span className="mono font-medium text-brand">{r.ref_no}</span><div className="max-w-[230px] truncate text-[12px] text-ink-soft">{r.institution} · {r.region}</div></td>
                        <td><div className="whitespace-nowrap">{r.stage_name}</div><div className="text-[12px] text-ink-soft">{r.substatus_text}</div></td>
                        <td>{r.waiting_on === "institution" ? <span className="text-ink-soft">Institution</span> : r.waiting_on === "committee" ? <span className="text-ink-soft">Committee</span> : <Owner name={r.assignee} />}</td>
                        <td>{bar ? <SlaBar {...bar} compact /> : <span className="text-ink-soft">–</span>}</td>
                        <td><DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} /></td>
                        <td><SlaStamp status={r.sla_status} days={r.days_to_due} level={r.escalation_level} waitingOn={r.waiting_on} solid /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          ) : <Empty title={station ? `No cases at ${stationLabel}.` : "No cases in progress here."}>Pick another step or Region.</Empty>}
          {listed.length > LIST_MAX && (
            <Link href="/applications" className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium no-underline">
              {listed.length - LIST_MAX} more, most urgent shown first. Open the full case list <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </Card>

      <div className="mb-6 grid items-start gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card title="Regions" subtitle={metric === "cases" ? "Cases in progress. Click a tile to scope the page." : "Overdue cases. Click a tile to scope the page."}
          action={<Tabs className="whitespace-nowrap" value={metric} onChange={(v) => setMetric(v as "cases" | "overdue")} tabs={[{ id: "cases", label: "Pendency" }, { id: "overdue", label: "Overdue" }]} />}>
          {tiles.length ? <RegionTiles data={tiles} metric={metric} value={region} onChange={setRegion} /> : <div className="skeleton h-[250px]" />}
          {user.official_kind === "regional" && region !== user.region_id && (
            <button onClick={() => setRegion(user.region_id)} className="mt-3 text-[12.5px] font-medium text-brand hover:underline">Back to my Region ({user.region_name})</button>
          )}
        </Card>
        <Card title="Next 90 days" subtitle="Undertakings due, documents expiring and expert visits">
          {today ? <HeatCalendar today={today} events={events} cell={15} /> : null}
        </Card>
      </div>

      <div className="mb-6 grid items-start gap-5 xl:grid-cols-3">
        <Card title="Who is the case waiting on?" subtitle="Total days across cases in progress">
          <SplitBar institution={t.institution_days} aicte={t.aicte_days} />
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div><dt className="text-[12px] text-ink-soft">Avg with AICTE / committees</dt><dd className="mono text-[20px] font-semibold tracking-[-0.02em]">{data.avg_aicte_days}<span className="text-[12px] font-normal text-ink-soft"> days</span></dd></div>
            <div><dt className="text-[12px] text-ink-soft">Avg with institutions</dt><dd className="mono text-[20px] font-semibold tracking-[-0.02em]">{data.avg_institution_days}<span className="text-[12px] font-normal text-ink-soft"> days</span></dd></div>
          </dl>
          <p className="mt-3 text-[12px] text-ink-soft">The AICTE time limit pauses while a deficiency reply is awaited, so institution time never counts against officers.</p>
        </Card>
        <Card title="Ageing" subtitle="Cases in progress by days since submission">
          <AgeingBars data={data.ageing} height={210} />
        </Card>
        <Card title="Compliance watch" subtitle="Undertakings, documents and visits" pad={false}>
          <ul className="divide-y divide-line">
            {([
              ["Undertakings overdue", c.undertakings_overdue, "/compliance", true],
              ["Evidence to verify", c.evidence_waiting, "/compliance", false],
              ["Documents expired", c.documents_expired, "/validity", true],
              ["Documents expiring soon", c.documents_expiring, "/validity", false],
              ["Renewals to verify", c.renewals_waiting, "/validity", false],
              ["EVC visits delayed", c.evc_delayed, "/evc", true],
              ["EVC visits due now", c.evc_due, "/evc", false],
            ] as [string, number, string, boolean][]).map(([label, n, href, bad]) => (
              <li key={label}>
                <Link href={href} className="flex items-center justify-between px-4 py-2 text-[13.5px] text-ink no-underline transition-colors hover:bg-surface-2">
                  <span className="flex items-center gap-2">{bad && n > 0 ? <Flag size={13} className="text-danger" /> : <span className="w-[13px]" />}{label}</span>
                  <span className={`mono text-[15px] font-semibold ${bad && n > 0 ? "text-danger-ink" : ""}`}>{n}</span>
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
                  <td><Link href={`/applications/${u.application_id}`} className="mono font-medium no-underline">{u.ref_no}</Link></td>
                  <td>{u.institution}</td>
                  <td>{u.visit_id ? "Assign EVC members" : "Assign an officer"}</td>
                  <td className="mono">{fmtDate(u.step_due_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="Everything is assigned." />}
      </Card>

      <CasePreview appId={preview} onClose={() => setPreview(null)} />
      <NextStep href="/queue" label="open my queue" />
    </div>
  );
}
