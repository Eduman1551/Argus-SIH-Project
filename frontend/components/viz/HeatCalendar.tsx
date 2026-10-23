"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addDays, fmtDate } from "@/lib/format";
import { daysBetween } from "./SlaBar";

export interface CalEvent { date: string; kind: "undertaking" | "document" | "evc"; label: string; href?: string }

const KIND: Record<CalEvent["kind"], [string, string]> = {
  undertaking: ["Undertaking due", "bg-brand"],
  document: ["Document expires", "bg-warn"],
  evc: ["Expert visit", "bg-ink-soft"],
};
// single-hue teal ramp; amber is kept for the exception (something due within a week)
const RAMP = ["#f1efe9", "#cfe5e1", "#97c6bf", "#4a958d", "#0f5e5a"];
const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

/**
 * GitHub-style calendar of the next `days` days: undertaking due dates, document expiries and EVC
 * visits, intensity by count. Days within the next week that have something due are outlined in
 * amber. The dark-ringed cell is "today" on the simulated clock, so it moves when time is advanced.
 */
export function HeatCalendar({ today, events, days = 90, cell = 16 }: { today: string; events: CalEvent[]; days?: number; cell?: number }) {
  const [focus, setFocus] = useState<string | null>(null);
  const gap = 3;
  const { cols, byDate, months } = useMemo(() => {
    const end = addDays(today, days - 1);
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const first = addDays(today, -weekday);
    const ncols = Math.ceil((daysBetween(first, end) + 1) / 7);
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const d = e.date.slice(0, 10);
      if (d < today || d > end) continue;
      map.set(d, [...(map.get(d) ?? []), e]);
    }
    const grid: { date: string; inRange: boolean }[][] = [];
    const ms: { col: number; label: string }[] = [];
    let lastMonth = "";
    for (let c = 0; c < ncols; c++) {
      const col = [];
      for (let r = 0; r < 7; r++) {
        const date = addDays(first, c * 7 + r);
        col.push({ date, inRange: date >= today && date <= end });
      }
      const m = fmtDate(col[6].date).slice(3, 6);
      if (m !== lastMonth) { ms.push({ col: c, label: m }); lastMonth = m; }
      grid.push(col);
    }
    return { cols: grid, byDate: map, months: ms };
  }, [today, events, days]);

  const all = [...byDate.values()].flat();
  const totals = (Object.keys(KIND) as CalEvent["kind"][]).map((k) => [k, all.filter((e) => e.kind === k).length] as const);
  const shown = focus ?? [...byDate.keys()].sort()[0] ?? null;
  const selected = shown ? byDate.get(shown) ?? [] : [];

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-4">
      <div className="min-w-0">
        <div className="flex gap-2 overflow-x-auto pb-1 scroll-thin">
          <div className="flex shrink-0 flex-col pt-[18px] text-[10.5px] text-ink-soft" style={{ gap }} aria-hidden>
            {WEEKDAYS.map((w, i) => <span key={i} style={{ height: cell, lineHeight: `${cell}px` }}>{w}</span>)}
          </div>
          <div>
            <div className="relative mb-1 h-[14px] text-[10.5px] text-ink-soft" aria-hidden>
              {months.map((m) => <span key={`${m.col}${m.label}`} className="absolute" style={{ left: m.col * (cell + gap) }}>{m.label}</span>)}
            </div>
            <div className="flex" style={{ gap }} role="grid" aria-label={`Deadlines in the next ${days} days`}>
              {cols.map((col, c) => (
                <div key={c} className="flex flex-col" style={{ gap }} role="row">
                  {col.map(({ date, inRange }) => {
                    const items = byDate.get(date) ?? [];
                    const soon = inRange && items.some((i) => i.kind !== "evc") && daysBetween(today, date) <= 7;
                    const isToday = date === today;
                    const ring = isToday ? "0 0 0 2px var(--surface), 0 0 0 3.5px var(--ink)" : soon ? "inset 0 0 0 2px var(--amber)" : items.length ? "none" : "inset 0 0 0 1px var(--line)";
                    return (
                      <button key={date} role="gridcell" disabled={!inRange} tabIndex={inRange ? 0 : -1}
                        aria-label={inRange ? `${fmtDate(date)}${isToday ? " (today)" : ""}: ${items.length ? items.map((i) => i.label).join("; ") : "nothing due"}` : undefined}
                        onMouseEnter={() => inRange && setFocus(date)} onFocus={() => inRange && setFocus(date)}
                        className={`rounded-[4px] transition-transform duration-100 hover:scale-110 disabled:pointer-events-none ${shown === date && !isToday ? "scale-110" : ""}`}
                        style={{ width: cell, height: cell, background: inRange ? RAMP[level(items.length)] : "transparent", boxShadow: inRange ? ring : "none" }} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-soft">
          <span className="flex items-center gap-1">Less {RAMP.map((r, i) => <span key={i} className="h-[10px] w-[10px] rounded-[2px]" style={{ background: r }} />)} More</span>
          <span className="flex items-center gap-1"><span className="h-[10px] w-[10px] rounded-[2px]" style={{ boxShadow: "inset 0 0 0 2px var(--amber)" }} />due within 7 days</span>
          <span className="flex items-center gap-1"><span className="h-[10px] w-[10px] rounded-[2px]" style={{ boxShadow: "0 0 0 1px var(--surface), 0 0 0 2.5px var(--ink)" }} />today</span>
        </div>
      </div>

      <div className="min-w-[200px] flex-1 text-[12.5px]">
        <ul className="mb-3 space-y-1">
          {totals.map(([k, n]) => (
            <li key={k} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-ink-soft"><span className={`h-1.5 w-1.5 rounded-full ${KIND[k][1]}`} />{KIND[k][0]}</span>
              <span className="mono font-medium text-ink">{n}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2" aria-live="polite">
          {shown ? (
            <>
              <div className="mono mb-1 font-medium text-ink">{fmtDate(shown)}<span className="font-normal text-ink-soft">{shown === today ? " · today" : ` · in ${daysBetween(today, shown)} day(s)`}</span></div>
              {selected.length ? (
                <ul className="space-y-1">
                  {selected.slice(0, 4).map((e, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${KIND[e.kind][1]}`} />
                      {e.href ? <Link href={e.href} className="line-clamp-2 no-underline">{e.label}</Link> : <span className="line-clamp-2">{e.label}</span>}
                    </li>
                  ))}
                  {selected.length > 4 && <li className="text-ink-soft">and {selected.length - 4} more</li>}
                </ul>
              ) : <span className="text-ink-soft">Nothing due on this day.</span>}
            </>
          ) : <span className="text-ink-soft">Nothing due in the next {days} days.</span>}
          {!focus && shown && <div className="mt-1 text-[11.5px] text-ink-soft">The next date with something due. Point at any day to see it.</div>}
        </div>
      </div>
    </div>
  );
}
