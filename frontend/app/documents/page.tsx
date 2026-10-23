"use client";

import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { FilePicker } from "@/components/Files";
import { DocState } from "@/components/status";
import { ValidityBar } from "@/components/viz/ValidityBar";
import { Button, Callout, ErrorNote, Field, HelpBox, Modal, NextStep, PageHeader, PageSkeleton } from "@/components/ui";
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
      <Field label="Valid until (new expiry date)"><input type="date" className="field max-w-[200px]" min={minDate} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
    </Modal>
  );
}

export default function DocumentsPage() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const { data, error, loading, reload } = useApi<{ rows: TrackedDoc[]; expiring_soon_days: number }>(user.role === "institution" ? "/api/tracked-documents" : null);
  const [renewing, setRenewing] = useState<TrackedDoc | null>(null);
  if (user.role !== "institution") return <ErrorNote error={{ message: "This page is for institutions. Officials use Document validity." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Institution", href: "/" }, { label: "Documents" }]} title="Documents"
        description="Documents you must keep valid, such as the land lease. Upload the renewed document before it expires; AICTE verifies it." />
      <HelpBox id="documents">Argus warns you 60, 30 and 7 days before expiry (illustrative settings). An expired document that is not renewed is escalated to AICTE officers.</HelpBox>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.rows.map((d) => (
          <article key={d.id} className="surface enter flex flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[15.5px] font-semibold">{d.title}</h2>
                <div className="text-[12.5px] text-ink-soft">{d.issued_by}</div>
              </div>
              <DocState state={d.state} level={d.escalation_level} />
            </div>
            <div className="mt-4">{today && <ValidityBar from={d.valid_from} to={d.expires_on} today={today} state={d.state} />}</div>
            <div className={`mt-1 text-[12.5px] ${d.days_to_expiry < 0 ? "font-medium text-danger-ink" : d.state === "expiring_soon" ? "text-warn-ink" : "text-ink-soft"}`}>
              {d.days_to_expiry < 0 ? `Expired ${-d.days_to_expiry} day(s) ago` : `Expires ${dueText(d.days_to_expiry)}`}
            </div>
            {d.status === "renewal_submitted" && <div className="mt-3"><Callout kind="note" title="Renewal with AICTE">Submitted {fmtDate(d.renewal_submitted_at)}, new expiry {fmtDate(d.renewal_expires_on)}.</Callout></div>}
            {d.status === "renewal_rejected" && <div className="mt-3"><Callout kind="warning" title="Renewal not accepted">{d.remarks}</Callout></div>}
            <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
              {d.file_id && <a href={`/api/files/${d.file_id}`} download className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-[12.5px] font-medium text-ink no-underline hover:bg-surface-2"><Download size={13} /> Current document</a>}
              {d.status !== "renewal_submitted" && <Button kind={d.state === "valid" ? "secondary" : "primary"} small onClick={() => setRenewing(d)}><RefreshCw size={13} /> Upload renewal</Button>}
            </div>
          </article>
        ))}
      </div>
      {renewing && <RenewalModal d={renewing} close={() => setRenewing(null)} />}
      <NextStep href="/notifications" label="notifications" />
    </div>
  );
}
