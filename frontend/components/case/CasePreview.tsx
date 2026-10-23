"use client";

import { ArrowRight } from "lucide-react";
import { Drawer, ErrorNote, KeyVal, LinkButton, Owner, SlaStamp, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dueText, fmtDate } from "@/lib/format";
import { ACTION_TEXT } from "@/lib/labels";
import { useApp } from "@/lib/store";
import { SlaBar, SlaLegend } from "@/components/viz/SlaBar";
import { caseSla, type CaseDetail } from "./CaseView";

/** Quick case preview in a right-hand side sheet, so lists do not always navigate away. */
export function CasePreview({ appId, href, onClose }: { appId: number | null; href?: string; onClose: () => void }) {
  return (
    <Drawer open={appId != null} onClose={onClose} title={appId != null ? <PreviewTitle appId={appId} /> : ""}
      footer={appId != null && <LinkButton kind="primary" href={href ?? `/applications/${appId}`}>Open full case <ArrowRight size={14} /></LinkButton>}>
      {appId != null && <PreviewBody appId={appId} />}
    </Drawer>
  );
}

function PreviewTitle({ appId }: { appId: number }) {
  const { data } = useApi<CaseDetail>(`/api/applications/${appId}`);
  return <span className="mono">{data?.application.ref_no ?? "Loading…"}</span>;
}

function PreviewBody({ appId }: { appId: number }) {
  const today = useApp((s) => s.clock?.today);
  const { data, error, reload } = useApi<CaseDetail>(`/api/applications/${appId}`);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data || !today) return <div className="space-y-3"><Skeleton h={18} w="70%" /><Skeleton h={44} /><Skeleton h={120} /></div>;
  const a = data.application;
  const sla = caseSla(data, today);
  return (
    <div className="space-y-5 text-[13.5px]">
      <div>
        <div className="font-medium text-ink">{a.institution}</div>
        <div className="text-ink-soft">{a.type_name} · {a.programme}</div>
      </div>
      <ol className="flex flex-wrap items-center gap-1 text-[12px]">
        {data.route.map((s, i) => (
          <li key={s.seq} className="flex items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 ${s.state === "done" ? "bg-brand-tint text-brand" : s.state === "active" ? "bg-brand text-white" : "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line"}`}>{s.name}</span>
            {i < data.route.length - 1 && <span className="text-line-strong">›</span>}
          </li>
        ))}
      </ol>
      {a.status === "in_progress" && data.sla && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">Time limit, {data.sla.stage_name}</span>
            <SlaStamp status={data.sla.sla_status} days={data.sla.days_to_due} level={data.sla.escalation_level} waitingOn={data.sla.waiting_on} />
          </div>
          {sla && <SlaBar {...sla} />}
          <div className="mt-2"><SlaLegend /></div>
        </div>
      )}
      <KeyVal items={[
        ["Status", a.status === "decided" ? `Decided: ${a.decision?.replaceAll("_", " ")}` : data.sla?.substatus_text ?? "–"],
        ["With", data.sla?.waiting_on === "institution" ? a.institution : <Owner key="o" name={data.current?.assignee} />],
        ["Next due", data.sla?.due_date ? <span key="d" className="mono">{fmtDate(data.sla.due_date)} · {dueText(data.sla.days_to_due)}</span> : "–"],
        ["Submitted", <span key="s" className="mono">{fmtDate(a.submitted_at)}</span>],
      ]} />
      <div>
        <div className="mb-2 font-medium">Latest activity</div>
        <ul className="space-y-2">
          {[...data.timeline].reverse().slice(0, 5).map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="mono w-[78px] shrink-0 text-[12px] text-ink-soft">{fmtDate(e.at).slice(0, 6)}</span>
              <span className="min-w-0 flex-1"><span className="block">{ACTION_TEXT[e.action] ?? e.action}</span><span className="block truncate text-[12px] text-ink-soft">{e.actor_label}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
