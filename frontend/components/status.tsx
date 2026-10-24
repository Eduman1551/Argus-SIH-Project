"use client";

import { Stamp } from "@/components/ui";
import { EVC_CATEGORY } from "@/lib/labels";
import type { Undertaking, Visit } from "@/lib/types";

export function DocState({ state, level }: { state: string; level?: number | null }) {
  if (level) return <span className="inline-flex gap-1"><Stamp tone="overdue">Expired</Stamp><Stamp tone="escalated" level={level}>L{level}</Stamp></span>;
  if (state === "expired") return <Stamp tone="overdue">Expired</Stamp>;
  if (state === "expiring_soon") return <Stamp tone="soon">Expiring soon</Stamp>;
  if (state === "renewal_submitted") return <Stamp tone="waiting">Renewal submitted</Stamp>;
  return <Stamp tone="ok">Valid</Stamp>;
}

export function UndertakingState({ u, solid }: { u: Undertaking; solid?: boolean }) {
  if (u.escalation_level) return <span className="inline-flex flex-wrap gap-1"><Stamp tone="overdue" solid={solid} /><Stamp tone="escalated" level={u.escalation_level}>L{u.escalation_level}</Stamp></span>;
  if (u.state === "overdue") return <Stamp tone="overdue" solid={solid} />;
  if (u.state === "due_soon") return <Stamp tone="soon">Due soon</Stamp>;
  if (u.state === "awaiting_verification") return <Stamp tone="waiting">Awaiting verification</Stamp>;
  if (u.state === "closed") return <Stamp tone="closed">Verified</Stamp>;
  if (u.status === "resubmission_requested") return <Stamp tone="soon">Resubmit</Stamp>;
  return <Stamp tone="neutral">Open</Stamp>;
}

export function VisitStamp({ v }: { v: Visit }) {
  if (v.escalation_level) return <Stamp tone="escalated" level={v.escalation_level} />;
  if (v.category === "delayed") return <Stamp tone="overdue">Delayed</Stamp>;
  if (v.category === "due") return <Stamp tone="soon">Visit due</Stamp>;
  if (v.category === "completed") return <Stamp tone="closed">Completed</Stamp>;
  return <Stamp tone="neutral">{EVC_CATEGORY[v.category] ?? v.category}</Stamp>;
}

const RISK_WORD = { high: "High risk", medium: "Medium risk", low: "Low risk" } as const;

/** Delay risk as a word and a colour (never colour alone), with the score when given. */
export function RiskPill({ band, score }: { band: "low" | "medium" | "high"; score?: number | null }) {
  const tone = band === "high" ? "overdue" : band === "medium" ? "soon" : "ok";
  return (
    <Stamp tone={tone}>
      {RISK_WORD[band]}{score != null && <span className="mono">{score}</span>}
    </Stamp>
  );
}
