"use client";

import { useEffect, useRef, useState } from "react";
import {
  BellRing, CalendarCheck2, Check, CircleDot, ClipboardCheck, Copy, FileUp, Flag, Gavel, GitBranch, MessageSquareWarning, Send, Users,
} from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ACTION_TEXT, DECISION_TEXT, ENTITY_TEXT, STAGE_NAME } from "@/lib/labels";

export interface AuditEntry {
  id: number; at: string; actor_label: string; actor_id: number | null; action: string;
  entity_type: string; entity_id: string; details: Record<string, unknown>; hash?: string;
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
    case "deficiency.raised": return `${s("reason")} Reply due ${s("response_due")}. Time limit paused.`;
    case "deficiency.responded": return `${s("reply")} Time limit resumed after ${s("paused_days")} day(s).`;
    case "decision.recorded": return `${DECISION_TEXT[s("outcome")] ?? s("outcome")}: ${s("reason")}`;
    case "stage.reverted": return `Back to ${STAGE_NAME[s("to")] ?? s("to")}: ${s("reason")}`;
    case "evc.scheduled": case "evc.rescheduled": return `Visit on ${s("visit_date")}`;
    case "evc.members_assigned": return Array.isArray(d.members) ? (d.members as string[]).join(", ") : null;
    case "committee.recommended": return `${s("recommendation").replaceAll("_", " ")}: ${s("remarks")}`;
    case "alert.fired": {
      const what = ENTITY_TEXT[s("item").split(":")[0]] ?? "item";
      return `${s("kind") === "overdue" ? "Overdue" : `Reminder, ${Math.abs(Number(d.offset_days))} day(s) before`}: ${what.toLowerCase()} due ${s("due_date")}`;
    }
    case "escalation.raised": return `Level ${s("level")}, to ${s("escalated_to")}`;
    case "document.uploaded": return s("filename");
    default: return null;
  }
}

function iconFor(action: string) {
  const g = action.split(".")[0];
  if (action === "decision.recorded") return <Gavel size={13} />;
  if (action.startsWith("escalation")) return <Flag size={13} />;
  if (action === "alert.fired") return <BellRing size={13} />;
  if (action === "deficiency.raised") return <MessageSquareWarning size={13} />;
  if (action === "deficiency.responded") return <Send size={13} />;
  if (action === "undertaking.verified" || action === "document.renewal_verified") return <Check size={13} />;
  if (g === "document") return <FileUp size={13} />;
  if (g === "undertaking") return <ClipboardCheck size={13} />;
  if (g === "evc") return <CalendarCheck2 size={13} />;
  if (g === "committee") return <Users size={13} />;
  if (g === "stage" || g === "application") return <GitBranch size={13} />;
  return <CircleDot size={13} />;
}

function tone(action: string) {
  if (action.startsWith("escalation.raised")) return "bg-esc-tint text-esc";
  if (action === "alert.fired") return "bg-warn-tint text-warn-ink";
  if (action === "deficiency.raised") return "bg-danger-tint text-danger-ink";
  if (action === "decision.recorded" || action.endsWith("verified") || action === "stage.completed") return "bg-brand-tint text-brand";
  return "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line";
}

function HashChip({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(hash); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked */ } }}
      title={`Audit hash ${hash}. Click to copy.`} aria-label={`Copy audit hash ${hash.slice(0, 8)}`}
      className="mono inline-flex h-[20px] items-center gap-1 rounded-md bg-surface-2 px-1.5 text-[11px] text-ink-soft ring-1 ring-inset ring-line hover:text-brand">
      {copied ? <Check size={10} /> : <Copy size={10} />}{hash.slice(0, 8)}
    </button>
  );
}

/** Vertical ledger of a case's audit events, newest first. Click an event for its details and audit hash. */
export default function Timeline({ entries, max = 12 }: { entries: AuditEntry[]; max?: number }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useEffect(() => {
    const ids = new Set(entries.map((e) => e.id));
    if (seen.current) setFresh(new Set([...ids].filter((i) => !seen.current!.has(i))));
    seen.current = ids;
  }, [entries]);

  const list = [...entries].reverse();
  const shown = all ? list : list.slice(0, max);
  return (
    <div>
      <ol className="relative">
        <span className="absolute bottom-2 left-[107px] top-2 hidden w-px bg-line sm:block" aria-hidden />
        {shown.map((e) => {
          const detail = detailText(e);
          const isOpen = open === e.id;
          return (
            <li key={e.id} className={`relative rounded-lg ${fresh.has(e.id) ? "flash" : ""} ${isOpen ? "bg-surface-2" : ""}`}>
              <button onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}
                className="grid w-full grid-cols-1 gap-x-3 rounded-lg px-1 py-2 text-left hover:bg-surface-2 sm:grid-cols-[96px_22px_minmax(0,1fr)]">
                <time className="mono pt-0.5 text-[11.5px] text-ink-soft" dateTime={e.at}>{fmtDate(e.at).slice(0, 6)}</time>
                <span className={`relative z-[1] hidden h-[22px] w-[22px] items-center justify-center rounded-full sm:flex ${tone(e.action)}`} aria-hidden>{iconFor(e.action)}</span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium leading-snug text-ink">{ACTION_TEXT[e.action] ?? e.action}</span>
                  {detail && <span className={`block text-[13px] leading-snug text-ink ${isOpen ? "" : "truncate"}`}>{detail}</span>}
                  <span className="mt-0.5 block text-[12px] text-ink-soft">{e.actor_id == null ? "Argus" : e.actor_label.split(" (")[0]}</span>
                </span>
              </button>
              {isOpen && (
                <div className="enter flex flex-wrap items-center gap-x-4 gap-y-1 pb-2.5 pl-1 text-[12px] text-ink-soft sm:pl-[131px]">
                  <span className="mono">{fmtDateTime(e.at)}</span>
                  {e.actor_id != null && <span>{e.actor_label}</span>}
                  {e.hash && <span className="flex items-center gap-1.5">Audit hash <HashChip hash={e.hash} /></span>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {list.length > max && (
        <button className="mt-1 text-[12.5px] font-medium text-brand hover:underline" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${list.length} events`}
        </button>
      )}
    </div>
  );
}
