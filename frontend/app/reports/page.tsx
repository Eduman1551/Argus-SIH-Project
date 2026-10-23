"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Download } from "lucide-react";
import { Card, Empty, ErrorNote, HelpBox, Metrics, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Stat, Table, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { EVC_CATEGORY } from "@/lib/labels";
import { useApp } from "@/lib/store";

interface Report { name: string; title: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; totals: Record<string, number> }

const LIST = [
  ["pendency", "Pendency"], ["evc", "EVC status"], ["undertakings", "Undertakings"], ["documents", "Document validity"],
  ["overdue", "Overdue items"], ["regions", "Region-wise performance"],
];

function cell(key: string, v: unknown, row: Record<string, unknown>) {
  if (v === null || v === undefined || v === "") return <span className="text-ink-soft">–</span>;
  if (key === "sla_status") return <SlaStamp status={String(v)} waitingOn={row.waiting_on as string} />;
  if (key === "escalation_level") return <Stamp tone="escalated" level={Number(v)} />;
  if (key === "ref_no" || key === "ref") return <span className="mono whitespace-nowrap">{String(v)}</span>;
  if (key === "category") return v === "delayed" ? <Stamp tone="overdue">Delayed</Stamp> : <Stamp tone="neutral">{EVC_CATEGORY[String(v)] ?? String(v)}</Stamp>;
  if (key === "state") {
    const s = String(v);
    const tone = s === "overdue" || s === "expired" ? "overdue" : s.includes("soon") ? "soon" : s === "closed" || s === "valid" ? "closed" : "neutral";
    return <Stamp tone={tone}>{s.replaceAll("_", " ")}</Stamp>;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return <span className="mono whitespace-nowrap">{fmtDate(v)}</span>;
  if (typeof v === "number") return <span className="mono">{v}</span>;
  return String(v);
}

function ReportsInner() {
  const user = useApp((s) => s.user)!;
  const params = useSearchParams();
  const [name, setName] = useState(params.get("r") ?? "pendency");
  const [region, setRegion] = useState("");
  const regions = useApi<{ id: number; name: string }[]>("/api/regions");
  const q = region ? `?region_id=${region}` : "";
  const { data, error, loading, reload } = useApi<Report>(user.role === "official" ? `/api/reports/${name}${q}` : null);
  if (user.role !== "official") return <ErrorNote error={{ message: "Reports are for officials." }} />;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Insight" }, { label: "Reports" }]} title="Reports" description="Six standard reports, built from the same data as the dashboards. Totals here always match the dashboard."
        action={<a href={`/api/reports/${name}${q ? `${q}&` : "?"}format=csv`} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand bg-brand px-3.5 text-[13.5px] font-medium text-white no-underline shadow-sm transition-colors hover:border-brand-hover hover:bg-brand-hover hover:text-white" download>
          <Download size={15} /> Download CSV</a>} />
      <HelpBox id="reports">Pick a report, optionally filter by Region, and download it as CSV for meetings or follow-up letters. Every CSV is marked as synthetic data.</HelpBox>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs className="" value={name} onChange={setName} tabs={LIST.map(([id, label]) => ({ id, label }))} />
        <div className="flex items-center gap-2">
        <label htmlFor="region" className="text-[13px] text-ink-soft">Region</label>
        <select id="region" className="field h-9 w-auto py-0" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">All Regions</option>{regions.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        </div>
      </div>
      {loading ? <PageSkeleton /> : error || !data ? <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} /> : (
        <>
          <Metrics className="!grid-flow-row !auto-cols-auto sm:!grid-cols-4 lg:!grid-cols-8 [&>*]:border-b">
            {Object.entries(data.totals).map(([k, v]) => (
              <Stat key={k} label={k.charAt(0).toUpperCase() + k.slice(1).replaceAll("_", " ")} value={v}
                tone={/overdue|expired|delayed/.test(k) && v ? "red" : "ink"} />
            ))}
          </Metrics>
          <Card title={data.title} subtitle={`${data.rows.length} row(s)`} pad={false}>
            {data.rows.length ? (
              <div>
                <Table minWidth={1000} maxHeight={620}>
                  <thead><tr>{data.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>{data.rows.map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c.key}>{cell(c.key, r[c.key], r)}</td>)}</tr>)}</tbody>
                </Table>
              </div>
            ) : <Empty title="Nothing to report for this filter." />}
          </Card>
        </>
      )}
      <NextStep href="/audit" label="audit trail" />
    </div>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={<PageSkeleton />}><ReportsInner /></Suspense>;
}
