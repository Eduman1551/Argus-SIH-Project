"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { RiskPill } from "@/components/status";
import { Button, Card, Collapsible, Field, Modal, Stamp } from "@/components/ui";
import { act } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { CaseRisk, InterventionRow } from "@/lib/types";

const SPLIT: { key: string; label: string; cls: string }[] = [
  { key: "official", label: "Officials", cls: "bg-brand" },
  { key: "committee", label: "Committee", cls: "bg-[#6fb3a8]" },
  { key: "scheduling", label: "Scheduling", cls: "bg-[#a8d4cc]" },
  { key: "institution", label: "Institution", cls: "hatch" },
  { key: "system", label: "Gaps", cls: "bg-line-strong" },
];

/** Who the case has been waiting on: one stacked bar that adds up to 100 percent. */
export function WaitSplit({ split }: { split: CaseRisk["split"] }) {
  const parts = SPLIT.filter((s) => (split.percent[s.key] ?? 0) > 0);
  if (!parts.length) return null;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full ring-1 ring-inset ring-line" role="img"
        aria-label={parts.map((p) => `${p.label} ${split.percent[p.key]} percent`).join(", ")}>
        {parts.map((p) => <span key={p.key} className={p.cls} style={{ width: `${split.percent[p.key]}%` }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-soft">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-line ${p.cls}`} />
            {p.label} <b className="mono font-medium text-ink">{split.percent[p.key]}%</b>
            <span className="mono">({Math.round(split.days[p.key])}d)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function trend(risk: CaseRisk): string | null {
  const h = risk.history;
  if (h.length < 2 || !risk.assessment) return null;
  const last = h[h.length - 1];
  const weekAgo = [...h].reverse().find((p) => (Date.parse(last.assessed_on) - Date.parse(p.assessed_on)) / 864e5 >= 7);
  if (!weekAgo) return null;
  const word = { low: "Low", medium: "Medium", high: "High" }[weekAgo.band];
  return `A week earlier (${fmtDate(weekAgo.assessed_on).slice(0, 6)}): ${word}, ${weekAgo.score}.`;
}

export function WhyAtRisk({ risk }: { risk: CaseRisk }) {
  const a = risk.assessment;
  if (!a) return null;
  const was = trend(risk);
  return (
    <Card id="risk" title="Why at risk" subtitle="Predicted from the case facts; people decide what to do"
      action={<RiskPill band={a.band} score={a.score} />}>
      <p className="text-[13.5px] leading-relaxed">{a.summary}</p>
      {was && <p className="mt-1 text-[12px] text-ink-soft">{was}</p>}
      {a.reasons.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {a.reasons.map((r) => (
            <li key={r.code} className="flex items-baseline gap-3 text-[13px]">
              <span className="mono w-[54px] shrink-0 text-right font-semibold text-ink">+{r.points}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 text-[12px] font-medium text-ink-soft">Where the time went</div>
        <WaitSplit split={risk.split} />
      </div>
      <div className="mt-3 border-t border-line pt-1">
        <Collapsible title="How this was calculated">
          <p className="text-[12.5px] text-ink-soft">
            Score = 100 × sum of (weight × factor) ÷ sum of weights. Each factor runs from 0 to 1. Low below{" "}
            <span className="mono">{a.bands.medium}</span>, Medium from <span className="mono">{a.bands.medium}</span>, High
            from <span className="mono">{a.bands.high}</span>. Weights and bands are on the Rules page.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="data-table text-[12.5px]">
              <thead><tr><th>Factor</th><th className="num">Value</th><th className="num">Weight</th><th className="num">Points</th><th>Detail</th></tr></thead>
              <tbody>{a.factors.map((f) => (
                <tr key={f.code}><td>{f.label}</td><td className="num mono">{f.value.toFixed(2)}</td><td className="num mono">{f.weight}</td>
                  <td className="num mono">{f.points.toFixed(1)}</td><td className="text-ink-soft">{f.text}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-soft">
            Expected decision around <span className="mono text-ink">{fmtDate(a.projected_completion)}</span> ({a.remaining_days} days of
            expected work left) against a due date of <span className="mono text-ink">{fmtDate(a.case_due)}</span>; projected delay{" "}
            <span className="mono text-ink">{a.projected_delay}</span> days. Expected stage durations (configured limits adjusted by
            recent history): {Object.entries(a.expected).map(([k, v]) => `${k} ${v}d`).join(", ")}.
          </p>
        </Collapsible>
      </div>
    </Card>
  );
}

function outcomeText(i: InterventionRow): string | null {
  const o = (i.outcomes ?? []).find((x) => x.checkpoint === "completion") ?? (i.outcomes ?? [])[0];
  if (!o) return i.status === "approved" ? "Outcome is measured 7 days after approval." : null;
  if (o.checkpoint === "completion") {
    return `Decided ${o.on_time ? "on time" : `${o.delay_after} days late`}; ${o.days_saved >= 0 ? `${o.days_saved} days saved` : `${-o.days_saved} days lost`} against the projection.`;
  }
  return `After 7 days: risk ${i.score_before} → ${o.score_after}${o.risk_dropped ? " (lower)" : ""}; ${o.days_saved >= 0 ? `${o.days_saved} days saved` : `${-o.days_saved} days lost`} against the projection.`;
}

export function RecommendedAction({ risk }: { risk: CaseRisk }) {
  const rec = risk.recommendation;
  const past = risk.interventions.filter((i) => i.status === "approved" || i.status === "dismissed");
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  if (!rec && !past.length) return null;

  const approve = async () => {
    if (!rec) return;
    setBusy(true);
    const r = await act<{ done?: string }>(`/api/interventions/${rec.id}/accept`, {});
    if (r) useApp.getState().toast("success", `Approved. ${r.done ?? ""}`.trim());
    setBusy(false);
  };

  return (
    <Card id="recommendation" title="Recommended action" subtitle={rec ? rec.rule_label : "Earlier actions on this case"}
      action={rec ? <Stamp tone="info">Advice only</Stamp> : undefined}>
      {rec && (
        <div>
          <div className="text-[14px] font-semibold">{rec.action_text}</div>
          <p className="mt-1 text-[13px]">{rec.reason}</p>
          <p className="mt-1 text-[12.5px] text-ink-soft">{rec.effect}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {rec.can_act ? (
              <>
                <Button kind="primary" small busy={busy} onClick={approve}><Check size={14} /> Approve</Button>
                <Button small onClick={() => setDismissing(true)}><X size={14} /> Dismiss</Button>
              </>
            ) : <span className="text-[12.5px] text-ink-soft">Only {rec.authorized_text} can approve this.</span>}
            <span className="ml-auto text-[11.5px] text-ink-soft">Rule version {rec.rule_version}. Nothing runs until someone approves.</span>
          </div>
        </div>
      )}
      {past.length > 0 && (
        <ul className={`space-y-2 text-[13px] ${rec ? "mt-4 border-t border-line pt-3" : ""}`}>
          {past.slice(0, 3).map((i) => (
            <li key={i.id}>
              <span className="font-medium">{i.status === "approved" ? "Approved" : "Dismissed"}</span>
              <span className="text-ink-soft"> by {i.decided_by_name ?? "an officer"} on <span className="mono">{fmtDate(i.decided_at)}</span>: </span>
              {i.status === "approved" ? (i.result?.done ?? i.action_text) : `${i.rule_label}. ${i.decision_note ?? ""}`}
              {outcomeText(i) && <div className="text-[12.5px] text-ink-soft">{outcomeText(i)}</div>}
            </li>
          ))}
        </ul>
      )}
      {dismissing && rec && createPortal(<DismissModal id={rec.id} close={() => setDismissing(false)} />, document.body)}
    </Card>
  );
}

function DismissModal({ id, close }: { id: number; close: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await act(`/api/interventions/${id}/dismiss`, { reason }, "Recommendation dismissed. The reason is in the audit trail.");
    setBusy(false);
    if (r) close();
  };
  return (
    <Modal title="Dismiss recommendation" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={reason.trim().length < 10} onClick={submit}>Dismiss</Button></>}>
      <Field label="Why is it not needed?" hint="At least 10 characters. It is recorded with your name.">
        <textarea className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}
