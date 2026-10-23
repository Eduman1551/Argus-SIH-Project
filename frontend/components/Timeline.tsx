"use client";

import { useState } from "react";
import { Bot, User } from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ACTION_TEXT, DECISION_TEXT, ENTITY_TEXT, STAGE_NAME } from "@/lib/labels";

export interface AuditEntry {
  id: number; at: string; actor_label: string; actor_id: number | null; action: string;
  entity_type: string; entity_id: string; details: Record<string, unknown>;
}

function detailText(e: AuditEntry): string | null {
  const d = e.details ?? {};
  const s = (k: string) => {
    const v = d[k] == null ? "" : String(d[k]);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : v;
  };
  switch (e.action) {
    case "stage.started": return `${STAGE_NAME[s("stage")] ?? s("stage")}, due ${s("due_date")} (${s("sla_days")} days)`;
    case "stage.assigned": return `${s("assignee")}${d.method === "workload" ? " (by workload)" : d.method === "manual" ? " (reassigned)" : ""}`;
    case "stage.completed": return `${STAGE_NAME[s("stage")] ?? s("stage")}${d.on_time === false ? " (late)" : ""}${d.remarks ? `: ${s("remarks")}` : ""}`;
    case "application.routed": return `${STAGE_NAME[s("from")] ?? s("from")} → ${STAGE_NAME[s("to")] ?? s("to")}`;
    case "deficiency.raised": return `${s("reason")} Reply due ${s("response_due")}. SLA clock paused.`;
    case "deficiency.responded": return `${s("reply")} SLA resumed after ${s("paused_days")} day(s).`;
    case "decision.recorded": return `${DECISION_TEXT[s("outcome")] ?? s("outcome")}: ${s("reason")}`;
    case "stage.reverted": return `Back to ${STAGE_NAME[s("to")] ?? s("to")}: ${s("reason")}`;
    case "evc.scheduled": case "evc.rescheduled": return `Visit on ${s("visit_date")}`;
    case "evc.members_assigned": return Array.isArray(d.members) ? (d.members as string[]).join(", ") : null;
    case "committee.recommended": return `${s("recommendation").replaceAll("_", " ")}: ${s("remarks")}`;
    case "alert.fired": {
      const what = ENTITY_TEXT[s("item").split(":")[0]] ?? "item";
      return `${s("kind") === "overdue" ? "Overdue alert" : `Reminder ${Math.abs(Number(d.offset_days))} day(s) before`}: ${what.toLowerCase()} due ${s("due_date")}, sent to ${s("recipients")} people`;
    }
    case "escalation.raised": return `Level ${s("level")} to ${s("escalated_to")}, ${s("offset_days")} days after due`;
    case "document.uploaded": return `${s("filename")} v${s("version")} · SHA-256 ${s("sha256").slice(0, 10)}…`;
    default: return null;
  }
}

export default function Timeline({ entries, max = 14 }: { entries: AuditEntry[]; max?: number }) {
  const [all, setAll] = useState(false);
  const list = [...entries].reverse();
  const shown = all ? list : list.slice(0, max);
  return (
    <div>
      <ol className="relative ml-2 border-l border-line">
        {shown.map((e) => {
          const system = e.actor_id == null;
          const important = e.action.startsWith("decision") || e.action.startsWith("escalation") || e.action === "deficiency.raised";
          return (
            <li key={e.id} className="mb-3 ml-4">
              <span className={`absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full border ${important ? "border-brand bg-brand text-white" : system ? "border-line bg-paper-2 text-ink-soft" : "border-line bg-card text-brand"}`}>
                {system ? <Bot size={11} /> : <User size={11} />}
              </span>
              <div className="text-[13.5px] font-semibold leading-snug text-ink">{ACTION_TEXT[e.action] ?? e.action}</div>
              {detailText(e) && <div className="text-[13px] leading-snug text-ink">{detailText(e)}</div>}
              <div className="text-[12px] text-ink-soft">{fmtDateTime(e.at)} · {e.actor_label}</div>
            </li>
          );
        })}
      </ol>
      {list.length > max && (
        <button className="ml-2 text-[13px] font-medium text-brand hover:underline" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${list.length} entries`}
        </button>
      )}
    </div>
  );
}
