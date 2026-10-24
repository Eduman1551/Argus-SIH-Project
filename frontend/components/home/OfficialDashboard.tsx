"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, ListTodo, MapPin } from "lucide-react";
import { CasePreview } from "@/components/case/CasePreview";
import { DelaysBuilding, NeedsAttention } from "@/components/intel/DashboardIntel";
import { HeatCalendar, type CalEvent } from "@/components/viz/HeatCalendar";
import { ProcessLine, STATIONS, stationOf, type StationId } from "@/components/viz/ProcessLine";
import { RegionTiles, type RegionStat } from "@/components/viz/RegionTiles";
import { SlaBar, rowSla } from "@/components/viz/SlaBar";
import {
  Card, DueCell, Empty, ErrorNote, FilterChips, HelpBox, LinkButton, Metrics, NextStep, PageHeader, PageSkeleton, SlaStamp,
  Stat, Table, Tabs, useRowNav,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { OfficialDashboard as Dash, IntelOverview, PendencyRow, TrackedDoc, Undertaking, Visit } from "@/lib/types";

const LIST_MAX = 6;

export default function OfficialDashboard() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const [region, setRegion] = useState<number | null>(user.official_kind === "regional" ? user.region_id : null);
  const [station, setStation] = useState<StationId | null>(null);
  const [metric, setMetric] = useState<"cases" | "overdue">("cases");
  const [view, setView] = useState<"regions" | "calendar">("regions");
  const [preview, setPreview] = useState<number | null>(null);

  const { data, error, loading, reload } = useApi<Dash>(`/api/dashboard${region ? `?region_id=${region}` : "?all_regions=true"}`);
  const pend = useApi<{ rows: PendencyRow[] }>("/api/reports/pendency");
  const intel = useApi<IntelOverview>(`/api/intelligence/overview${region ? `?region_id=${region}` : "?all_regions=true"}`);
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
  const stationLabel = STATIONS.find((s) => s.id === station)?.label;

  const chips = [
    ...(region != null ? [{ key: "r", label: <><MapPin size={12} /> {regionName ?? "Region"}</>, onRemove: () => setRegion(null) }] : []),
    ...(station ? [{ key: "s", label: `At ${stationLabel}`, onRemove: () => setStation(null) }] : []),
  ];

  return (
    <div>
      <PageHeader crumbs={[{ label: "Overview" }]} title="Dashboard"
        description={<>Where cases stand and what is about to slip. Showing <b className="font-medium text-ink">{data.scope}</b>.</>}
        action={<LinkButton kind="primary" href="/queue"><ListTodo size={15} /> Open my queue</LinkButton>} />
      <HelpBox id="dashboard">Start with the red numbers. Click a step or a Region to see just those cases.</HelpBox>

      <Metrics>
        <Stat label="In progress" value={t.cases} hint={`Average age ${data.avg_age_days} days`} href="/applications?status=in_progress" />
        <Stat label="Overdue" value={t.overdue} tone={t.overdue ? "red" : "good"} hint="Past their time limit" href="/applications?sla=overdue" />
        <Stat label="Due soon" value={t.due_soon} tone={t.due_soon ? "warn" : "ink"} hint="Due in the next few days" href="/applications?sla=due_soon" />
        <Stat label="Escalated" value={t.escalated} tone={t.escalated ? "red" : "ink"} hint="Sent up the chain" href="/escalations" />
      </Metrics>

      {intel.data ? (
        <div className="mb-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <NeedsAttention data={intel.data} />
          <DelaysBuilding data={intel.data} />
        </div>
      ) : <div className="skeleton mb-6 h-[180px]" />}

      <Card title="Where cases are" subtitle="Click a step to list its cases" className="mb-6">
        {pend.data ? <ProcessLine rows={scoped} value={station} onChange={setStation}
          delay={intel.data ? Object.fromEntries(Object.entries(intel.data.cases).map(([k, v]) => [k, v.projected_delay])) : undefined} /> : <div className="skeleton h-[150px]" />}
        <div className="mt-4">
          <FilterChips chips={chips} onClear={() => { setRegion(null); setStation(null); }} />
          {shown.length ? (
            <div className="overflow-hidden rounded-xl border border-line">
              <Table minWidth={760}>
                <thead><tr><th>Case</th><th>Stage</th><th style={{ width: 160 }}>Time used</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {shown.map((r, i) => {
                    const bar = today ? rowSla(r, today) : null;
                    return (
                      <tr key={r.id} {...rowProps(i)} aria-label={`Preview ${r.ref_no}`}>
                        <td><span className="mono font-medium text-brand">{r.ref_no}</span><div className="max-w-[260px] truncate text-[12px] text-ink-soft">{r.institution}</div></td>
                        <td><div className="whitespace-nowrap">{r.stage_name}</div><div className="text-[12px] text-ink-soft">{r.substatus_text}</div></td>
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
              See all {listed.length} cases <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </Card>

      <Card title={view === "regions" ? "Regions" : "Next 90 days"}
        subtitle={view === "regions" ? "Click a Region to show only its cases" : "Undertakings, document expiries and expert visits"}
        action={<Tabs className="whitespace-nowrap" value={view} onChange={(v) => setView(v as "regions" | "calendar")} tabs={[{ id: "regions", label: "Regions" }, { id: "calendar", label: "Deadlines" }]} />}>
        {view === "regions" ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
            {tiles.length ? <RegionTiles data={tiles} metric={metric} value={region} onChange={setRegion} /> : <div className="skeleton h-[250px]" />}
            <div className="space-y-3 text-[13px]">
              <Tabs className="" value={metric} onChange={(v) => setMetric(v as "cases" | "overdue")} tabs={[{ id: "cases", label: "All cases" }, { id: "overdue", label: "Overdue" }]} />
              <p className="text-ink-soft">Darker tiles have more {metric === "cases" ? "cases in progress" : "overdue cases"}.</p>
              {user.official_kind === "regional" && region !== user.region_id && (
                <button onClick={() => setRegion(user.region_id)} className="font-medium text-brand hover:underline">Back to my Region</button>
              )}
            </div>
          </div>
        ) : today ? <HeatCalendar today={today} events={events} cell={15} /> : null}
      </Card>

      <CasePreview appId={preview} onClose={() => setPreview(null)} />
      <NextStep href="/queue" label="open my queue" />
    </div>
  );
}
