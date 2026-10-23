"use client";

import { fmtShort } from "@/lib/format";
import { daysBetween } from "./SlaBar";

/** How much of a document's validity is used up: valid-from to expiry, with a "today" caret. */
export function ValidityBar({ from, to, today, state }: { from: string; to: string; today: string; state: string }) {
  const total = Math.max(1, daysBetween(from, to));
  const used = daysBetween(from, today);
  const span = Math.max(total, used) * 1.04;
  const pct = (d: number) => `${Math.min(100, Math.max(0, (d / span) * 100))}%`;
  const color = state === "expired" ? "bg-danger" : state === "expiring_soon" ? "bg-warn" : "bg-brand";
  return (
    <div role="img" aria-label={`Valid from ${from} to ${to}`}>
      <div className="relative h-[18px]">
        <div className="absolute inset-x-0 top-[6px] h-[6px] rounded-full bg-surface-2 ring-1 ring-inset ring-line" />
        <div className="absolute left-0 top-[6px] h-[6px] rounded-full bg-brand-tint" style={{ width: pct(total) }} />
        <div className={`absolute left-0 top-[6px] h-[6px] rounded-l-full ${color}`} style={{ width: pct(Math.min(used, span)) }} />
        <span className="absolute top-[2px] h-[14px] w-[2px] rounded bg-ink" style={{ left: `calc(${pct(total)} - 1px)` }} />
      </div>
      <div className="mono flex justify-between text-[11.5px] text-ink-soft"><span>{fmtShort(from)}</span><span className="font-medium text-ink">Expires {fmtShort(to)}</span></div>
    </div>
  );
}
