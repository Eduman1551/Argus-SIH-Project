"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Download } from "lucide-react";
import { Card, Empty, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Table, Tabs } from "@/components/ui";
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
  if (key === "category") return v === "delayed" ? <Stamp tone="overdue">Delayed</Stamp> : <Stamp tone="neutral">{EVC_CATEGORY[String(v)] ?? String(v)}</Stamp>;
  if (key === "state") {
    const s = String(v);
    const tone = s === "overdue" || s === "expired" ? "overdue" : s.includes("soon") ? "soon" : s === "closed" || s === "valid" ? "closed" : "neutral";
    return <Stamp tone={tone}>{s.replaceAll("_", " ")}</Stamp>;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return <span className="whitespace-nowrap">{fmtDate(v)}</span>;
  if (typeof v === "number") return <span className="tabular-nums">{v}</span>;
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
      <PageHeader title="Reports" description="Six standard reports, built from the same data as the dashboards. Totals here always match the dashboard."
        action={<a href={`/api/reports/${name}${q ? `${q}&` : "?"}format=csv`} className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand px-3.5 py-2 text-sm font-medium text-white no-underline hover:bg-brand-deep hover:text-white" download>
          <Download size={16} /> Download CSV</a>} />
      <HelpBox id="reports">Pick a report, optionally filter by Region, and download it as CSV for meetings or follow-up letters. Every CSV is marked as synthetic data.</HelpBox>
      <Tabs value={name} onChange={setName} tabs={LIST.map(([id, label]) => ({ id, label }))} />
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="region" className="text-[14px] text-ink-soft">Region</label>
        <select id="region" className="input w-auto" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">All Regions</option>{regions.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {loading ? <PageSkeleton /> : error || !data ? <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(data.totals).map(([k, v]) => (
              <div key={k} className="sheet px-3 py-2"><div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft">{k.replaceAll("_", " ")}</div>
                <div className="font-serif text-xl font-semibold tabular-nums">{v}</div></div>
            ))}
          </div>
          <Card title={data.title} subtitle={`${data.rows.length} row(s)`} pad={false}>
            {data.rows.length ? (
              <div className="max-h-[620px] overflow-y-auto scroll-thin">
                <Table minWidth={1000}>
                  <thead className="sticky top-0"><tr>{data.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
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
