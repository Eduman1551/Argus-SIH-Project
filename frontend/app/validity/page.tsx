"use client";

import { useState } from "react";
import { DocState } from "@/components/home/InstitutionHome";
import VerifyButtons from "@/components/VerifyButtons";
import { Card, DueCell, Empty, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Stat, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { TrackedDoc } from "@/lib/types";

const STATES = [
  { id: "expired", label: "Expired", tone: "red" as const },
  { id: "expiring_soon", label: "Expiring soon", tone: "ochre" as const },
  { id: "renewal_submitted", label: "Renewal submitted", tone: "ink" as const },
  { id: "valid", label: "Valid", tone: "olive" as const },
];

export default function ValidityPage() {
  const user = useApp((s) => s.user)!;
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
      <PageHeader title="Document validity" description="Leases, fire NOCs and other documents institutions must keep valid. Argus warns before expiry and escalates when a document lapses."
        action={user.official_kind === "regional" ? (
          <div className="inline-flex rounded-md border border-line bg-card p-0.5 text-[13px]">
            <button onClick={() => setAll(false)} className={`rounded px-3 py-1.5 ${!all ? "bg-brand text-white" : ""}`}>My Region</button>
            <button onClick={() => setAll(true)} className={`rounded px-3 py-1.5 ${all ? "bg-brand text-white" : ""}`}>All Regions</button>
          </div>) : undefined} />
      <HelpBox id="validity">Click a state to filter. Renewals submitted by institutions wait for your verification; once verified, the new expiry date applies and tracking starts again.</HelpBox>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATES.map((s) => (
          <button key={s.id} onClick={() => setFilter(filter === s.id ? "" : s.id)} className={`text-left ${filter === s.id ? "ring-2 ring-brand rounded-lg" : ""}`}>
            <Stat label={s.label} value={rows.filter((d) => d.state === s.id).length} tone={s.tone}
              hint={s.id === "expiring_soon" ? `Within ${data.expiring_soon_days} days` : undefined} />
          </button>
        ))}
      </div>
      <Card title={filter ? STATES.find((s) => s.id === filter)!.label : "All tracked documents"} subtitle={`${shown.length} document(s)`} pad={false}>
        {shown.length ? (
          <Table minWidth={900}>
            <thead><tr><th>Institution</th><th>Document</th><th>Expires</th><th>State</th><th>Renewal</th></tr></thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td>{d.institution}<div className="text-[12.5px] text-ink-soft">{d.region}</div></td>
                  <td>{d.title}<div className="text-[12.5px] text-ink-soft">{d.issued_by}</div></td>
                  <td><DueCell date={d.expires_on} days={d.days_to_expiry} fmt={fmtDate} /></td>
                  <td><DocState state={d.state} level={d.escalation_level} />{d.status === "renewal_rejected" && <div className="mt-1 text-[12px] text-brand">Last renewal not accepted</div>}</td>
                  <td>
                    {d.status === "renewal_submitted" ? (
                      <div className="space-y-1.5 text-[13px]">
                        <div>New expiry {fmtDate(d.renewal_expires_on)} · <a href={`/api/files/${d.renewal_file_id}`} download>view file</a></div>
                        <VerifyButtons path={`/api/tracked-documents/${d.id}/verify`} what="Renewal" />
                      </div>
                    ) : <span className="text-[13px] text-ink-soft">{d.verified_at ? `Last verified ${fmtDate(d.verified_at)}` : "–"}</span>}
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
