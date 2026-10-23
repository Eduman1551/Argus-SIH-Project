"use client";

import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Button, Field, Modal } from "@/components/ui";
import { act } from "@/lib/api";

/** Accept, or send back with a mandatory reason. Used for undertaking evidence and document renewals. */
export default function VerifyButtons({ path, what }: { path: string; what: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (accept: boolean) => {
    setBusy(true);
    const ok = await act(path, { accept, remarks: remarks || null },
      accept ? `${what} verified.` : `${what} sent back to the institution with your reason.`);
    setBusy(false);
    if (ok) setRejecting(false);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button small kind="primary" busy={busy && !rejecting} onClick={() => send(true)}><Check size={14} /> Verify</Button>
      <Button small onClick={() => setRejecting(true)}><RotateCcw size={14} /> Ask to resubmit</Button>
      {rejecting && (
        <Modal title={`Send ${what.toLowerCase()} back`} onClose={() => setRejecting(false)}
          footer={<><Button onClick={() => setRejecting(false)}>Cancel</Button><Button kind="danger" busy={busy} disabled={remarks.trim().length < 10} onClick={() => send(false)}>Send back</Button></>}>
          <Field label="Reason (required)" hint="Tell the institution exactly what is missing."><textarea className="field" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
