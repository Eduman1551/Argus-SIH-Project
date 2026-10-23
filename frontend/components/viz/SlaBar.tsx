"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { addDays, fmtDate, fmtShort } from "@/lib/format";
import { useApp } from "@/lib/store";

const DAY = 86400000;
const toMs = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).getTime();
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);

export interface SlaBarProps {
  start: string;            // stage start (date)
  due: string;              // the AICTE time limit for the stage, already moved out by any pause
  today: string;
  institutionDays?: number; // days of this stage spent waiting on the institution (hatched)
  openPause?: boolean;      // the institution time is the current, still-open pause (drawn at the end)
  ticks?: number[];         // reminder offsets relative to the due date (e.g. -2, 0)
  compact?: boolean;
  dueSoonDays?: number;
}

/**
 * Bullet-style bar: time used in the current stage against the allowed time. Solid = time with AICTE
 * officers or committees, hatched = time waiting on the institution (the AICTE clock was paused).
 * Ticks mark the reminder days, the dark marker the due date, the caret today.
 */
export function SlaBar({ start, due, today, institutionDays = 0, openPause, ticks = [], compact, dueSoonDays = 3 }: SlaBarProps) {
  const elapsed = Math.max(0, daysBetween(start, today));
  const allowed = Math.max(1, daysBetween(start, due));
  const span = Math.max(allowed, elapsed) * (compact ? 1.06 : 1.1) || 1;
  const pct = (d: number) => `${Math.min(100, Math.max(0, (d / span) * 100))}%`;
  const inst = Math.min(institutionDays, elapsed);
  const officer = elapsed - inst;
  const left = daysBetween(today, due);
  const color = left < 0 ? "bg-danger" : left <= dueSoonDays ? "bg-warn" : "bg-brand";
  // Officer time first, then institution time. An open pause is the latest stretch, so this is exact
  // for it; closed pauses are summed into the same hatched segment (their position is not shown).
  const instStart = officer;
  void openPause;
  const label = `${elapsed} of ${allowed} day(s) used${inst ? `, ${inst} waiting on the institution` : ""}. ${left < 0 ? `${-left} day(s) past the limit` : `${left} day(s) left`} (due ${fmtDate(due)}).`;

  return (
    <div className={compact ? "w-full min-w-[110px]" : "w-full"} role="img" aria-label={`Time limit: ${label}`} title={compact ? label : undefined}>
      <div className={`relative ${compact ? "h-[14px]" : "h-[22px]"}`}>
        {/* track */}
        <div className={`absolute inset-x-0 ${compact ? "top-[5px] h-[5px]" : "top-[8px] h-[7px]"} rounded-full bg-surface-2 ring-1 ring-inset ring-line`} />
        {/* allowed window */}
        <div className={`absolute left-0 ${compact ? "top-[5px] h-[5px]" : "top-[8px] h-[7px]"} rounded-full bg-brand-tint`} style={{ width: pct(allowed) }} />
        {/* officer time */}
        <div className={`absolute left-0 ${compact ? "top-[5px] h-[5px]" : "top-[8px] h-[7px]"} rounded-l-full ${color}`} style={{ width: pct(officer) }} />
        {/* institution time (hatched) */}
        {inst > 0 && (
          <div className={`hatch absolute ${compact ? "top-[5px] h-[5px]" : "top-[8px] h-[7px]"}`} style={{ left: pct(instStart), width: pct(inst) }} />
        )}
        {/* reminder ticks */}
        {ticks.map((t) => {
          const d = allowed + t;
          if (d < 0 || d > span) return null;
          return <span key={t} className={`absolute w-px bg-ink-soft/60 ${compact ? "top-[2px] h-[3px]" : "top-[3px] h-[5px]"}`} style={{ left: pct(d) }} aria-hidden />;
        })}
        {/* due marker */}
        <span className={`absolute w-[2px] rounded bg-ink ${compact ? "top-[2px] h-[11px]" : "top-[3px] h-[17px]"}`} style={{ left: `calc(${pct(allowed)} - 1px)` }} aria-hidden />
        {/* today caret */}
        <span className="absolute -translate-x-1/2" style={{ left: pct(elapsed), top: compact ? 10 : 15 }} aria-hidden>
          <svg width={compact ? 7 : 9} height={compact ? 5 : 6} viewBox="0 0 9 6"><path d="M4.5 0 9 6H0z" fill="var(--ink)" /></svg>
        </span>
      </div>
      {!compact && (
        <div className="relative mt-1 h-4 text-[11.5px] text-ink-soft">
          <span className="mono absolute left-0">{fmtShort(start)}</span>
          <span className="mono absolute -translate-x-1/2 whitespace-nowrap font-medium text-ink" style={{ left: pct(allowed) }}>Due {fmtShort(due)}</span>
        </div>
      )}
    </div>
  );
}

export function SlaLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-soft">
      <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-brand" />With AICTE / committee</span>
      <span className="flex items-center gap-1.5"><span className="hatch h-2 w-4 rounded-sm" />Waiting on institution (clock paused)</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-[2px] bg-ink" />Due date</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-px bg-ink-soft" />Reminder</span>
    </div>
  );
}

/** Pendency rows carry the stage window; turn one into SlaBar props. */
export interface StageWindow {
  stage_started: string | null; stage_due: string | null; stage_paused_days: number | null;
  stage_paused_now: boolean | null; stage_open_pause_days: number | null;
}
export function rowSla(r: StageWindow, today: string) {
  if (!r.stage_started || !r.stage_due) return null;
  return {
    start: r.stage_started,
    due: addDays(r.stage_due, r.stage_paused_now ? r.stage_open_pause_days ?? 0 : 0),
    today,
    institutionDays: r.stage_paused_days ?? 0,
    openPause: !!r.stage_paused_now,
  };
}

let ticksCache: Promise<Record<string, number[]>> | null = null;
/** Reminder offsets by item type from the Rules (officials only; others get no ticks). */
export function useReminderTicks(): Record<string, number[]> {
  const user = useApp((s) => s.user);
  const [ticks, setTicks] = useState<Record<string, number[]>>({});
  useEffect(() => {
    if (user?.role !== "official") return;
    ticksCache ??= api<{ reminders: { entity_type: string; kind: string; offset_days: number; active: boolean }[] }>("/api/rules")
      .then((r) => {
        const out: Record<string, number[]> = {};
        r.reminders.filter((x) => x.active && x.kind === "reminder").forEach((x) => { (out[x.entity_type] ??= []).push(x.offset_days); });
        return out;
      })
      .catch(() => ({}));
    ticksCache.then(setTicks);
  }, [user?.role]);
  return ticks;
}
