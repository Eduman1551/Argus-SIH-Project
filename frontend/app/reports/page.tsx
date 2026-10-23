"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { Download } from "lucide-react";
import { Card, Drawer, Empty, ErrorNote, HelpBox, KeyVal, Metrics, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Stat, Table, Tabs, useRowNav } from "@/components/ui";
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
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const rows = data?.rows ?? [];
  const onOpen = useCallback((i: number) => setRow(rows[i] ?? null), [rows]);
  const rowProps = useRowNav(rows.length, onOpen);
  const label = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replaceAll("_", " ").replace(/\baicte\b/i, "AICTE").replace(/\bevc\b/i, "EVC");
  if (user.role !== "official") return <ErrorNote error={{ message: "Reports are for officials." }} />;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Reports" }]} title="Reports" description="Six standard reports. Totals match the dashboard."
        action={<a href={`/api/reports/${name}${q ? `${q}&` : "?"}format=csv`} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand bg-brand px-3.5 text-[13.5px] font-medium text-white no-underline shadow-sm transition-colors hover:border-brand-hover hover:bg-brand-hover hover:text-white" download>
          <Download size={15} /> Download CSV</a>} />
      <HelpBox id="reports">Pick a report and download it as CSV. Click a row to see every field.</HelpBox>
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
          <Metrics>
            {Object.entries(data.totals).slice(0, 4).map(([k, v]) => (
              <Stat key={k} label={label(k)} value={v} tone={/overdue|expired|delayed/.test(k) && v ? "red" : "ink"} />
            ))}
          </Metrics>
          {Object.keys(data.totals).length > 4 && (
            <p className="-mt-3 mb-5 text-[12.5px] text-ink-soft">
              Also: {Object.entries(data.totals).slice(4).map(([k, v]) => `${label(k)} ${v}`).join(" · ")}
            </p>
          )}
          <Card title={data.title} subtitle={`${data.rows.length} rows${data.columns.length > 6 ? ", main columns shown; the CSV has them all" : ""}`} pad={false}>
            {data.rows.length ? (
              <div>
                <Table minWidth={860} maxHeight={620}>
                  <thead><tr>{data.columns.slice(0, 6).map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>{data.rows.map((r, i) => <tr key={i} {...rowProps(i)}>{data.columns.slice(0, 6).map((c) => <td key={c.key}>{cell(c.key, r[c.key], r)}</td>)}</tr>)}</tbody>
                </Table>
              </div>
            ) : <Empty title="Nothing to report for this filter." />}
          </Card>
        </>
      )}
      <Drawer open={!!row} onClose={() => setRow(null)} title={data?.title ?? ""} subtitle={row ? String(row[data?.columns[0]?.key ?? ""] ?? "") : undefined}>
        {row && data && <KeyVal items={data.columns.map((c) => [c.label, cell(c.key, row[c.key], row)] as [string, React.ReactNode])} />}
      </Drawer>
      <NextStep href="/audit" label="audit trail" />
    </div>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={<PageSkeleton />}><ReportsInner /></Suspense>;
}
