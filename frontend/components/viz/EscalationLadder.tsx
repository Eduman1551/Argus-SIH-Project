"use client";

import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { api } from "@/lib/api";
import { addDays, fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import { daysBetween } from "./SlaBar";

export interface Rung { level: number; title: string; reachedAt?: string | null; to?: string | null }

/**
 * L1, L2 and L3 as a small ladder (L3 on top): who was alerted at each level and when, and the next
 * step with a countdown when it is known.
 */
export function EscalationLadder({ rungs, next, today, compact }: {
  rungs: Rung[]; next?: { level: number; date: string } | null; today?: string; compact?: boolean;
}) {
  const ordered = [...rungs].sort((a, b) => b.level - a.level);
  return (
    <ol className={`relative ${compact ? "space-y-1" : "space-y-2"}`} aria-label="Escalation ladder">
      <span className="absolute bottom-3 left-[11px] top-3 w-px bg-line" aria-hidden />
      {ordered.map((r) => {
        const reached = !!r.reachedAt;
        const isNext = next?.level === r.level;
        const left = isNext && today ? daysBetween(today, next!.date) : null;
        return (
          <li key={r.level} className="relative flex items-start gap-3">
            <span className={`relative z-[1] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${reached ? "bg-esc text-white" : isNext ? "bg-surface text-esc" : "bg-surface-2 text-ink-soft ring-1 ring-line"}`}
              style={isNext ? { outline: "1.5px dashed var(--maroon)", outlineOffset: -1.5 } : undefined}>
              {reached ? <Flag size={11} aria-hidden /> : `L${r.level}`}
            </span>
            <div className={`min-w-0 flex-1 ${compact ? "text-[12.5px]" : "text-[13px]"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className={reached ? "font-medium text-esc" : isNext ? "font-medium text-ink" : "text-ink-soft"}>{r.title}</span>
                {reached ? (
                  <span className="mono text-[11.5px] text-ink-soft">{fmtDate(r.reachedAt)}</span>
                ) : isNext ? (
                  <span className="mono text-[11.5px] font-medium text-esc">{left != null ? (left <= 0 ? "due today" : `in ${left} day(s)`) : "next"}</span>
                ) : <span className="text-[11.5px] text-ink-soft">not reached</span>}
              </div>
              {reached && r.to && !compact && <div className="text-[12px] text-ink-soft">Alerted: {r.to}</div>}
              {isNext && next && <div className="text-[12px] text-ink-soft">Will escalate on <span className="mono">{fmtDate(next.date)}</span> if still open</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

interface EscRules { levels: { level: number; title: string }[]; days: Record<string, number[]> }
let cache: Promise<EscRules | null> | null = null;

/** Escalation chain titles and day offsets from the Rules (officials only; null for others). */
export function useEscalationRules(): EscRules | null {
  const role = useApp((s) => s.user?.role);
  const [rules, setRules] = useState<EscRules | null>(null);
  useEffect(() => {
    if (role !== "official") return;
    cache ??= api<{ escalation_levels: { level: number; title: string }[]; escalation_rules: { entity_type: string; level: number; days_after_due: number; active: boolean }[] }>("/api/rules")
      .then((r) => {
        const days: Record<string, number[]> = {};
        r.escalation_rules.filter((x) => x.active).sort((a, b) => a.level - b.level).forEach((x) => { (days[x.entity_type] ??= []).push(x.days_after_due); });
        return { levels: r.escalation_levels, days };
      })
      .catch(() => null);
    cache.then(setRules);
  }, [role]);
  return rules;
}

const DEFAULT_TITLES = ["L1: Regional Director", "L2: Bureau Officer", "L3: Bureau Head"];

/** Build ladder rungs for one item from its escalation alerts (title "Escalated to L2: …: item"). */
export function rungsFor(alerts: { level: number | null; fired_at: string; title: string }[], rules: EscRules | null): Rung[] {
  return [1, 2, 3].map((level) => {
    const hit = alerts.find((a) => a.level === level);
    const fromTitle = hit?.title.match(/^Escalated to (L\d: .+?): /)?.[1];
    const title = rules?.levels.find((l) => l.level === level)?.title ?? fromTitle ?? DEFAULT_TITLES[level - 1];
    return { level, title, reachedAt: hit?.fired_at ?? null, to: title.replace(/^L\d:\s*/, "") };
  });
}

export function nextStep(entityType: string, dueDate: string | null | undefined, reachedLevel: number, rules: EscRules | null) {
  if (!rules || !dueDate || reachedLevel >= 3) return null;
  const days = rules.days[entityType]?.[reachedLevel];
  return days == null ? null : { level: reachedLevel + 1, date: addDays(dueDate, days) };
}
