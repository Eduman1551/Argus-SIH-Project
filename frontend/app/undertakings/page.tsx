"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Send } from "lucide-react";
import { FileList, FilePicker } from "@/components/Files";
import { UndertakingState } from "@/components/status";
import { Button, Callout, Card, Empty, ErrorNote, Field, HelpBox, Metrics, NextStep, PageHeader, PageSkeleton, Stat } from "@/components/ui";
import { act, useApi } from "@/lib/api";
import { dueText, fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Undertaking } from "@/lib/types";

function EvidenceForm({ u }: { u: Undertaking }) {
  const [open, setOpen] = useState(u.state === "overdue" || u.state === "due_soon" || u.status === "resubmission_requested");
  const [note, setNote] = useState("");
  const [fileId, setFileId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await act(`/api/undertakings/${u.id}/evidence`, { file_id: fileId, note }, "Evidence submitted. AICTE will verify it.");
    setBusy(false);
  };
  if (!open) {
    return <Button small kind="primary" onClick={() => setOpen(true)}><ChevronDown size={14} /> Submit evidence</Button>;
  }
  return (
    <div className="enter space-y-3 rounded-xl border border-line bg-surface-2 p-3.5">
      <Field label="Describe your evidence"><textarea className="field min-h-[64px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did to meet the condition and what you are uploading." /></Field>
      <FilePicker entityType="undertaking" entityId={u.id} slot="evidence" label="Upload evidence" onUploaded={(f) => setFileId(f.id)} />
      <Button kind="primary" small busy={busy} disabled={!fileId && note.trim().length < 10} onClick={submit}><Send size={14} /> Submit evidence</Button>
    </div>
  );
}

export default function UndertakingsPage() {
  const user = useApp((s) => s.user)!;
  const { data, error, loading, reload } = useApi<{ rows: Undertaking[] }>(user.role === "institution" ? "/api/undertakings" : null);
  if (user.role !== "institution") return <ErrorNote error={{ message: "This page is for institutions. Officials use Compliance." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const open = data.rows.filter((u) => u.state !== "closed");
  const closed = data.rows.filter((u) => u.state === "closed");

  return (
    <div>
      <PageHeader crumbs={[{ label: "Institution", href: "/" }, { label: "Undertakings" }]} title="Undertakings"
        description="Conditions attached to your approvals, each with a due date. Upload evidence before the date; AICTE verifies it and closes the undertaking." />
      <HelpBox id="undertakings">Argus reminds you 30, 15, 7 and 1 day(s) before a due date (illustrative settings). If evidence is not verified by the due date, the undertaking is escalated.</HelpBox>
      <Metrics>
        <Stat label="Open" value={open.length} />
        <Stat label="Overdue" value={open.filter((u) => u.state === "overdue").length} tone="red" />
        <Stat label="Awaiting verification" value={open.filter((u) => u.state === "awaiting_verification").length} tone="warn" />
        <Stat label="Closed" value={closed.length} tone="good" />
      </Metrics>

      <div className="space-y-3">
        {open.length ? open.map((u) => (
          <article key={u.id} className={`surface enter grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_200px] ${u.state === "overdue" ? "border-l-[3px] border-l-danger" : u.state === "due_soon" ? "border-l-[3px] border-l-warn" : ""}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-[15px] font-semibold leading-snug">{u.condition_text}</h2>
                <UndertakingState u={u} />
              </div>
              <div className="mt-1 text-[12.5px] text-ink-soft">From <Link href={`/applications/${u.application_id}`} className="mono">{u.ref_no}</Link></div>
              {u.last_submission && (
                <div className="mt-3 text-[13px]">
                  <span className="text-ink-soft">Last submission <span className="mono">{fmtDate(u.last_submission.submitted_at)}</span>:</span> {u.last_submission.note || "file only"}
                  {u.last_submission.review_status === "resubmission_requested" && (
                    <div className="mt-2"><Callout kind="warning" title="Sent back by AICTE">{u.last_submission.review_remarks}</Callout></div>
                  )}
                </div>
              )}
              {u.files && u.files.length > 0 && <div className="mt-2"><FileList files={u.files} /></div>}
              <div className="mt-3">
                {(u.status === "open" || u.status === "resubmission_requested") && <EvidenceForm u={u} />}
                {u.status === "evidence_submitted" && <p className="text-[13px] text-ink-soft">Your evidence is with AICTE for verification. Nothing more to do for now.</p>}
              </div>
            </div>
            <div className="border-line md:border-l md:pl-4">
              <div className="text-[12px] text-ink-soft">Due</div>
              <div className="mono text-[18px] font-semibold">{fmtDate(u.due_date)}</div>
              <div className={`text-[12.5px] ${u.days_to_due < 0 ? "font-medium text-danger-ink" : u.days_to_due <= 7 ? "text-warn-ink" : "text-ink-soft"}`}>{dueText(u.days_to_due)}</div>
            </div>
          </article>
        )) : <Card><Empty title="No open undertakings.">Undertakings appear here when an approval is given with conditions.</Empty></Card>}
        {closed.length > 0 && (
          <Card title="Closed undertakings" subtitle="Verified by AICTE" pad={false}>
            <ul className="divide-y divide-line">
              {closed.map((u) => <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]"><span>{u.condition_text}</span><UndertakingState u={u} /></li>)}
            </ul>
          </Card>
        )}
      </div>
      <NextStep href="/documents" label="documents and renewals" />
    </div>
  );
}
