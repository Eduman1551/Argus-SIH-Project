"use client";

import { useState } from "react";
import { DocState } from "@/components/status";
import { ValidityBar } from "@/components/viz/ValidityBar";
import VerifyButtons from "@/components/VerifyButtons";
import { Card, DueCell, Empty, ErrorNote, FilterChips, HelpBox, Metrics, NextStep, PageHeader, PageSkeleton, Stat, Table, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { TrackedDoc } from "@/lib/types";

const STATES = [
  { id: "expired", label: "Expired", tone: "red" as const },
  { id: "expiring_soon", label: "Expiring soon", tone: "warn" as const },
  { id: "renewal_submitted", label: "Renewal submitted", tone: "ink" as const },
  { id: "valid", label: "Valid", tone: "good" as const },
];

export default function ValidityPage() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const [all, setAll] = useState(user.official_kind !== "regional");
  const [filter, setFilter] = useState("");
  const { data, error, loading, reload } = useApi<{ rows: TrackedDoc[]; expiring_soon_days: number }>(
    user.role === "official" ? `/api/tracked-documents${all ? "?all_regions=true" : ""}` : null);
  if (user.role !== "official") return <ErrorNote error={{ message: "The validity board is for officials. Institutions use the Documents page." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const rows = data.rows;
  const shown = rows.filter((d) => !filter || d.state === filter);
  const order = ["expired", "renewal_submitted", "expiring_soon", "valid"];
  shown.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.days_to_expiry - b.days_to_expiry);

  return (
    <div>
      <PageHeader crumbs={[{ label: "Monitoring" }, { label: "Document validity" }]} title="Document validity" description="Leases and other documents institutions must keep valid."
        action={user.official_kind === "regional" ? (
          <Tabs className="" value={all ? "all" : "mine"} onChange={(v) => setAll(v === "all")}
            tabs={[{ id: "mine", label: "My Region" }, { id: "all", label: "All Regions" }]} />) : undefined} />
      <HelpBox id="validity">Click a number to filter. Check renewals sent in by institutions.</HelpBox>
      <Metrics>
        {STATES.map((s) => (
          <button key={s.id} onClick={() => setFilter(filter === s.id ? "" : s.id)} aria-pressed={filter === s.id}
            className={`text-left transition-colors hover:bg-surface-2 ${filter === s.id ? "bg-brand-tint/70 shadow-[inset_0_-2px_0_var(--brand)]" : ""}`}>
            <Stat label={s.label} value={rows.filter((d) => d.state === s.id).length} tone={rows.some((d) => d.state === s.id) ? s.tone : "ink"}
              hint={s.id === "expiring_soon" ? `Within ${data.expiring_soon_days} days` : filter === s.id ? "Showing these" : undefined} />
          </button>
        ))}
      </Metrics>
      <FilterChips chips={filter ? [{ key: "f", label: STATES.find((s) => s.id === filter)!.label, onRemove: () => setFilter("") }] : []} />
      <Card title={filter ? STATES.find((s) => s.id === filter)!.label : "All tracked documents"} subtitle={`${shown.length} document(s)`} pad={false}>
        {shown.length ? (
          <Table minWidth={900}>
            <thead><tr><th>Institution</th><th>Document</th><th style={{ width: 150 }}>Time used</th><th>Expires</th><th>State</th><th>Renewal</th></tr></thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td>{d.institution}<div className="text-[12.5px] text-ink-soft">{d.region}</div></td>
                  <td>{d.title}</td>
                  <td>{today && d.valid_from ? <ValidityBar from={d.valid_from} to={d.expires_on} today={today} state={d.state} compact /> : null}</td>
                  <td><DueCell date={d.expires_on} days={d.days_to_expiry} fmt={fmtDate} /></td>
                  <td><DocState state={d.state} level={d.escalation_level} />{d.status === "renewal_rejected" && <div className="mt-1 text-[12px] text-danger-ink">Last renewal not accepted</div>}</td>
                  <td>
                    {d.status === "renewal_submitted" ? (
                      <div className="space-y-1.5 text-[13px]">
                        <div>New expiry <span className="mono">{fmtDate(d.renewal_expires_on)}</span> · <a href={`/api/files/${d.renewal_file_id}`} download>view file</a></div>
                        <VerifyButtons path={`/api/tracked-documents/${d.id}/verify`} what="Renewal" />
                      </div>
                    ) : <span className="text-[13px] text-ink-soft">{"–"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="No documents in this state." />}
      </Card>
      <NextStep href="/escalations" label="escalations" />
    </div>
  );
}
