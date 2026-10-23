"use client";

import Link from "next/link";
import { useState } from "react";
import { UndertakingState } from "@/components/home/InstitutionHome";
import VerifyButtons from "@/components/VerifyButtons";
import { Card, DueCell, Empty, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Stat, Table, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Undertaking } from "@/lib/types";

export default function CompliancePage() {
  const user = useApp((s) => s.user)!;
  const [all, setAll] = useState(user.official_kind !== "regional");
  const [tab, setTab] = useState("verify");
  const [filter, setFilter] = useState("");
  const { data, error, loading, reload } = useApi<{ rows: Undertaking[] }>(user.role === "official" ? `/api/undertakings${all ? "?all_regions=true" : ""}` : null);
  if (user.role !== "official") return <ErrorNote error={{ message: "Compliance monitoring is for officials. Institutions use the Undertakings page." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const rows = data.rows;
  const count = (s: string) => rows.filter((u) => u.state === s).length;
  const waiting = rows.filter((u) => u.state === "awaiting_verification");
  const shown = rows.filter((u) => !filter || u.state === filter);

  return (
    <div>
      <PageHeader title="Undertakings and compliance" description="Time-bound conditions attached to approvals: what is due, what is overdue, and evidence waiting for you to verify."
        action={user.official_kind === "regional" ? (
          <div className="inline-flex rounded-md border border-line bg-card p-0.5 text-[13px]">
            <button onClick={() => setAll(false)} className={`rounded px-3 py-1.5 ${!all ? "bg-brand text-white" : ""}`}>My Region</button>
            <button onClick={() => setAll(true)} className={`rounded px-3 py-1.5 ${all ? "bg-brand text-white" : ""}`}>All Regions</button>
          </div>) : undefined} />
      <HelpBox id="compliance">Verify evidence from the first tab. If it is incomplete, ask the institution to resubmit with a reason. Undertakings that pass their due date are flagged and escalated automatically.</HelpBox>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Waiting for you" value={waiting.length} tone={waiting.length ? "ochre" : "olive"} />
        <Stat label="Overdue" value={count("overdue")} tone={count("overdue") ? "red" : "olive"} />
        <Stat label="Due soon" value={count("due_soon")} tone="ochre" />
        <Stat label="Open" value={count("open")} />
        <Stat label="Closed" value={count("closed")} tone="olive" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "verify", label: `Verification queue (${waiting.length})` }, { id: "all", label: `All undertakings (${rows.length})` }]} />
      {tab === "verify" ? (
        <Card title="Evidence waiting for verification" pad={false}>
          {waiting.length ? (
            <Table minWidth={900}>
              <thead><tr><th>Institution</th><th>Condition</th><th>Due</th><th>Evidence</th><th>Decision</th></tr></thead>
              <tbody>
                {waiting.map((u) => (
                  <tr key={u.id}>
                    <td>{u.institution}<div className="text-[12.5px] text-ink-soft">{u.ref_no}</div></td>
                    <td className="max-w-[300px]">{u.condition_text}</td>
                    <td><DueCell date={u.due_date} days={u.days_to_due} fmt={fmtDate} /></td>
                    <td className="text-[13.5px]">
                      {u.last_submission?.note}
                      {u.last_submission?.file_id && <div><a href={`/api/files/${u.last_submission.file_id}`} download>{u.last_submission.filename}</a></div>}
                      <div className="text-[12px] text-ink-soft">Submitted {fmtDate(u.last_submission?.submitted_at)}</div>
                    </td>
                    <td><VerifyButtons path={`/api/undertakings/${u.id}/verify`} what="Evidence" /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="No evidence is waiting.">When an institution uploads evidence it appears here.</Empty>}
        </Card>
      ) : (
        <Card title="All undertakings" pad={false} action={
          <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by state">
            <option value="">All states</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option>
            <option value="open">Open</option><option value="awaiting_verification">Awaiting verification</option><option value="closed">Closed</option>
          </select>}>
          <Table minWidth={860}>
            <thead><tr><th>Institution</th><th>Condition</th><th>Case</th><th>Due</th><th>State</th></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td>{u.institution}<div className="text-[12.5px] text-ink-soft">{u.region}</div></td>
                  <td className="max-w-[320px]">{u.condition_text}</td>
                  <td><Link href={`/applications/${u.application_id}`} className="no-underline">{u.ref_no}</Link></td>
                  <td><DueCell date={u.due_date} days={u.state === "closed" ? null : u.days_to_due} fmt={fmtDate} /></td>
                  <td><UndertakingState u={u} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <NextStep href="/validity" label="document validity board" />
    </div>
  );
}
