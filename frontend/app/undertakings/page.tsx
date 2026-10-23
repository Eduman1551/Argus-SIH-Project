"use client";

import Link from "next/link";
import { useState } from "react";
import { Send } from "lucide-react";
import { FileList, FilePicker } from "@/components/Files";
import { UndertakingState } from "@/components/home/InstitutionHome";
import { Button, Card, Empty, ErrorNote, Field, HelpBox, NextStep, PageHeader, PageSkeleton, Stat } from "@/components/ui";
import { act, useApi } from "@/lib/api";
import { dueText, fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Undertaking } from "@/lib/types";

function EvidenceForm({ u }: { u: Undertaking }) {
  const [note, setNote] = useState("");
  const [fileId, setFileId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await act(`/api/undertakings/${u.id}/evidence`, { file_id: fileId, note }, "Evidence submitted. AICTE will verify it.");
    setBusy(false);
  };
  return (
    <div className="mt-3 space-y-2 rounded-md border border-dashed border-line bg-paper/50 p-3">
      <Field label="Describe your evidence"><textarea className="input min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did to meet the condition and what you are uploading." /></Field>
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
      <PageHeader title="Undertakings" description="Conditions attached to your approvals, each with a due date. Upload evidence before the date; AICTE verifies it and closes the undertaking." />
      <HelpBox id="undertakings">Argus reminds you 30, 15, 7 and 1 day(s) before a due date (illustrative settings). If evidence is not verified by the due date, the undertaking is escalated.</HelpBox>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open" value={open.length} />
        <Stat label="Overdue" value={open.filter((u) => u.state === "overdue").length} tone="red" />
        <Stat label="Awaiting verification" value={open.filter((u) => u.state === "awaiting_verification").length} tone="ochre" />
        <Stat label="Closed" value={closed.length} tone="olive" />
      </div>
      <div className="space-y-4">
        {open.length ? open.map((u) => (
          <Card key={u.id} title={u.condition_text} subtitle={<>From <Link href={`/applications/${u.application_id}`}>{u.ref_no}</Link> · due {fmtDate(u.due_date)} ({dueText(u.days_to_due)})</>}
            action={<UndertakingState u={u} />}>
            {u.last_submission && (
              <div className="text-[13.5px]">
                <span className="font-semibold">Last submission</span> on {fmtDate(u.last_submission.submitted_at)}: {u.last_submission.note || "file only"}
                {u.last_submission.review_status === "resubmission_requested" && (
                  <div className="mt-1.5 rounded-md border-l-4 border-brand bg-brand-tint/40 px-3 py-1.5">Sent back by AICTE: {u.last_submission.review_remarks}</div>
                )}
              </div>
            )}
            {u.files && u.files.length > 0 && <div className="mt-2"><FileList files={u.files} /></div>}
            {(u.status === "open" || u.status === "resubmission_requested") && <EvidenceForm u={u} />}
            {u.status === "evidence_submitted" && <p className="mt-2 text-[13.5px] text-ink-soft">Your evidence is with AICTE for verification. Nothing more to do for now.</p>}
          </Card>
        )) : <Card><Empty title="No open undertakings.">Undertakings appear here when an approval is given with conditions.</Empty></Card>}
        {closed.length > 0 && (
          <Card title="Closed undertakings" subtitle="Verified by AICTE">
            <ul className="space-y-1.5 text-[14px]">
              {closed.map((u) => <li key={u.id} className="flex items-center justify-between gap-2"><span>{u.condition_text}</span><UndertakingState u={u} /></li>)}
            </ul>
          </Card>
        )}
      </div>
      <NextStep href="/documents" label="documents and renewals" />
    </div>
  );
}
