"use client";

import Link from "next/link";
import { useState } from "react";
import { Flag } from "lucide-react";
import { Card, Empty, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Stamp, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ENTITY_TEXT } from "@/lib/labels";
import { useApp } from "@/lib/store";

interface Esc {
  id: number; entity_type: string; entity_id: number; level: number; due_date: string; escalated_at: string; status: string;
  resolved_at: string | null; title: string; application_id: number | null; ref_no: string | null; institution: string | null;
  region: string | null; target: string | null; level_title: string; days_overdue: number;
}

function link(e: Esc) {
  if (e.entity_type === "undertaking") return "/compliance";
  if (e.entity_type === "document") return "/validity";
  return e.application_id ? `/applications/${e.application_id}` : "/";
}

export default function EscalationsPage() {
  const user = useApp((s) => s.user)!;
  const [all, setAll] = useState(user.official_kind !== "regional");
  const { data, error, loading, reload } = useApi<{ open: Esc[]; resolved: Esc[]; levels: { level: number; title: string; target: string }[] }>(
    user.role === "official" ? `/api/escalations${all ? "?all_regions=true" : ""}` : null);
  if (user.role !== "official") return <ErrorNote error={{ message: "Escalations are visible to officials." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;

  return (
    <div>
      <PageHeader title="Escalations" description="Overdue items that have gone up the chain, grouped by level. Each one is resolved automatically when the item is completed."
        action={user.official_kind === "regional" ? (
          <div className="inline-flex rounded-md border border-line bg-card p-0.5 text-[13px]">
            <button onClick={() => setAll(false)} className={`rounded px-3 py-1.5 ${!all ? "bg-brand text-white" : ""}`}>My Region</button>
            <button onClick={() => setAll(true)} className={`rounded px-3 py-1.5 ${all ? "bg-brand text-white" : ""}`}>All Regions</button>
          </div>) : undefined} />
      <HelpBox id="escalations">The chain and the number of days before each level are set on the Rules page. Open an item to act on it; the escalation clears on the next check once the item is done.</HelpBox>
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        {data.levels.map((l) => {
          const n = data.open.filter((e) => e.level === l.level).length;
          return (
            <div key={l.level} className={`sheet settle px-4 py-3.5 ${l.level === 3 ? "border-brand-deep/50" : ""}`}>
              <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wide text-ink-soft"><Flag size={14} className="text-brand-deep" /> Level {l.level}</div>
              <div className="mt-1 font-serif text-[32px] font-semibold leading-none text-brand-deep">{n}</div>
              <div className="mt-1 text-[13px] text-ink-soft">{l.title}</div>
            </div>
          );
        })}
      </div>
      <Card title="Open escalations" subtitle="Highest level first, then most overdue" pad={false} className="mb-5">
        {data.open.length ? (
          <Table minWidth={960}>
            <thead><tr><th>Level</th><th>Item</th><th>Institution</th><th>Was due</th><th className="num">Days overdue</th><th>Escalated to</th><th>Since</th></tr></thead>
            <tbody>
              {data.open.map((e) => (
                <tr key={e.id}>
                  <td><Stamp tone="escalated" level={e.level} /></td>
                  <td className="max-w-[320px]"><Link href={link(e)} className="font-medium no-underline">{e.title}</Link><div className="text-[12.5px] text-ink-soft">{ENTITY_TEXT[e.entity_type]}{e.ref_no ? ` · ${e.ref_no}` : ""}</div></td>
                  <td>{e.institution}<div className="text-[12.5px] text-ink-soft">{e.region}</div></td>
                  <td>{fmtDate(e.due_date)}</td>
                  <td className="num font-semibold text-brand">{e.days_overdue}</td>
                  <td className="text-[13.5px]">{e.target}<div className="text-[12px] text-ink-soft">{e.level_title}</div></td>
                  <td>{fmtDate(e.escalated_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="No open escalations.">Advance the clock to see overdue items escalate.</Empty>}
      </Card>
      <Card title="Recently resolved" pad={false}>
        {data.resolved.length ? (
          <Table>
            <thead><tr><th>Level</th><th>Item</th><th>Institution</th><th>Resolved</th></tr></thead>
            <tbody>{data.resolved.map((e) => (
              <tr key={e.id}><td><Stamp tone="closed">L{e.level} resolved</Stamp></td><td className="max-w-[360px]">{e.title}</td><td>{e.institution}</td><td>{fmtDate(e.resolved_at)}</td></tr>
            ))}</tbody>
          </Table>
        ) : <Empty title="Nothing resolved yet." />}
      </Card>
      <NextStep href="/reports" label="reports" />
    </div>
  );
}
