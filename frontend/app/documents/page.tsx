"use client";

import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { FilePicker } from "@/components/Files";
import { DocState } from "@/components/home/InstitutionHome";
import { Button, Card, ErrorNote, Field, HelpBox, KeyVal, Modal, NextStep, PageHeader, PageSkeleton } from "@/components/ui";
import { act, useApi } from "@/lib/api";
import { addDays, dueText, fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { TrackedDoc } from "@/lib/types";

function RenewalModal({ d, close }: { d: TrackedDoc; close: () => void }) {
  const today = useApp.getState().clock?.today ?? "";
  const minDate = addDays(d.expires_on > today ? d.expires_on : today, 1);
  const [fileId, setFileId] = useState<number | null>(null);
  const [expiry, setExpiry] = useState(addDays(d.expires_on > today ? d.expires_on : today, 365));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const ok = await act(`/api/tracked-documents/${d.id}/renewal`, { file_id: fileId, new_expiry: expiry }, "Renewal submitted. AICTE will verify it.");
    setBusy(false);
    if (ok) close();
  };
  return (
    <Modal title={`Upload renewed ${d.title}`} onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={!fileId || expiry < minDate} onClick={submit}>Submit renewal</Button></>}>
      <FilePicker entityType="tracked_document" entityId={d.id} slot="renewal" label="Upload renewed document" onUploaded={(f) => setFileId(f.id)} />
      <Field label="Valid until (new expiry date)"><input type="date" className="input max-w-[200px]" min={minDate} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
    </Modal>
  );
}

export default function DocumentsPage() {
  const user = useApp((s) => s.user)!;
  const { data, error, loading, reload } = useApi<{ rows: TrackedDoc[]; expiring_soon_days: number }>(user.role === "institution" ? "/api/tracked-documents" : null);
  const [renewing, setRenewing] = useState<TrackedDoc | null>(null);
  if (user.role !== "institution") return <ErrorNote error={{ message: "This page is for institutions. Officials use Document validity." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;

  return (
    <div>
      <PageHeader title="Documents" description="Documents you must keep valid, such as the land lease. Upload the renewed document before it expires; AICTE verifies it." />
      <HelpBox id="documents">Argus warns you 60, 30 and 7 days before expiry (illustrative settings). An expired document that is not renewed is escalated to AICTE officers.</HelpBox>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.rows.map((d) => (
          <Card key={d.id} title={d.title} subtitle={d.issued_by} action={<DocState state={d.state} level={d.escalation_level} />}>
            <KeyVal items={[
              ["Valid from", fmtDate(d.valid_from)],
              ["Expires", <span key="e" className={d.days_to_expiry < 0 ? "font-semibold text-brand" : ""}>{fmtDate(d.expires_on)} ({dueText(d.days_to_expiry).replace("late", "ago")})</span>],
              ["Renewal", d.status === "renewal_submitted" ? `Submitted ${fmtDate(d.renewal_submitted_at)}, new expiry ${fmtDate(d.renewal_expires_on)}` : d.status === "renewal_rejected" ? `Not accepted: ${d.remarks}` : "–"],
            ]} />
            <div className="mt-3 flex flex-wrap gap-2 border-t border-line/70 pt-3">
              {d.file_id && <a href={`/api/files/${d.file_id}`} download className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-[13px] no-underline"><Download size={14} /> Current document</a>}
              {d.status !== "renewal_submitted" && <Button kind={d.state === "valid" ? "secondary" : "primary"} small onClick={() => setRenewing(d)}><RefreshCw size={14} /> Upload renewal</Button>}
            </div>
          </Card>
        ))}
      </div>
      {renewing && <RenewalModal d={renewing} close={() => setRenewing(null)} />}
      <NextStep href="/notifications" label="notifications" />
    </div>
  );
}
