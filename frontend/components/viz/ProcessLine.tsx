"use client";

import { RAMP } from "@/components/charts";
import type { PendencyRow } from "@/lib/types";

export const STATIONS = [
  { id: "intake", label: "Intake", who: "Officer" },
  { id: "scrutiny", label: "Scrutiny", who: "Officer" },
  { id: "deficiency", label: "Deficiency", who: "Institution" },
  { id: "rescrutiny", label: "Re-scrutiny", who: "Officer" },
  { id: "evc", label: "EVC", who: "Committee" },
  { id: "sac", label: "Committee", who: "SAC/SHC" },
  { id: "decision", label: "Decision", who: "Authority" },
] as const;
export type StationId = (typeof STATIONS)[number]["id"];

/** Which station of the process line a case in progress is sitting at. */
export function stationOf(r: Pick<PendencyRow, "stage_code" | "substatus">): StationId {
  if (r.substatus === "awaiting_institution") return "deficiency";
  if (r.substatus === "re_review") return "rescrutiny";
  return (STATIONS.some((s) => s.id === r.stage_code) ? r.stage_code : "scrutiny") as StationId;
}

function dotColour(r: PendencyRow) {
  if (r.sla_status === "overdue") return "var(--red)";
  const d = r.days_in_stage;
  return RAMP[d < 7 ? 1 : d < 21 ? 2 : d < 45 ? 3 : 4];
}

const MAX_DOTS = 12;

/**
 * The application journey drawn as a line of stations. Each station shows how many cases sit there,
 * how many are overdue, and one dot per case shaded by days in stage (red = overdue). Click to filter.
 */
export function ProcessLine({ rows, value, onChange }: { rows: PendencyRow[]; value: StationId | null; onChange: (s: StationId | null) => void }) {
  const at = new Map<StationId, PendencyRow[]>(STATIONS.map((s) => [s.id, []]));
  rows.forEach((r) => at.get(stationOf(r))!.push(r));
  return (
    <div className="overflow-x-auto">
      <ol className="relative grid min-w-[760px] grid-cols-7" aria-label="Cases at each stage of the process">
        <span className="absolute left-[7%] right-[7%] top-[15px] h-[2px] bg-line" aria-hidden />
        {STATIONS.map((s) => {
          const list = [...at.get(s.id)!].sort((a, b) => b.days_in_stage - a.days_in_stage);
          const overdue = list.filter((r) => r.sla_status === "overdue").length;
          const on = value === s.id;
          const avg = list.length ? Math.round(list.reduce((t, r) => t + r.days_in_stage, 0) / list.length) : 0;
          return (
            <li key={s.id} className="relative">
              <button onClick={() => onChange(on ? null : s.id)} aria-pressed={on}
                aria-label={`${s.label}: ${list.length} cases, ${overdue} overdue. ${on ? "Clear filter" : "Show these cases"}`}
                className={`group flex w-full flex-col items-center rounded-xl px-1.5 pb-3 pt-0 text-center transition-colors ${on ? "bg-brand-tint" : "hover:bg-surface-2"}`}>
                <span className={`relative z-[1] mt-[7px] flex h-[18px] w-[18px] items-center justify-center rounded-full ring-4 ring-surface transition-transform group-hover:scale-110 ${list.length ? (overdue ? "bg-danger" : "bg-brand") : "bg-line-strong"}`}>
                  {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className={`mt-2 text-[13px] font-medium ${on ? "text-brand-hover" : "text-ink"}`}>{s.label}</span>
                <span className="text-[11.5px] text-ink-soft">{s.who}</span>
                <span className="mono mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">{list.length}</span>
                <span className={`mt-1 h-[16px] text-[11.5px] ${overdue ? "font-medium text-danger-ink" : "text-ink-soft"}`}>
                  {overdue ? `${overdue} overdue` : list.length ? `avg ${avg}d here` : "none"}
                </span>
                <span className="mt-1.5 flex min-h-[10px] max-w-[110px] flex-wrap justify-center gap-[3px]" aria-hidden>
                  {list.slice(0, MAX_DOTS).map((r) => (
                    <span key={r.id} className="h-[7px] w-[7px] rounded-full" style={{ background: dotColour(r) }} title={`${r.ref_no}: ${r.days_in_stage} days here`} />
                  ))}
                  {list.length > MAX_DOTS && <span className="mono text-[10px] leading-[7px] text-ink-soft">+{list.length - MAX_DOTS}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[12px] text-ink-soft">
        <span>One dot per case, by days at the stage:</span>
        {[["under 7", RAMP[1]], ["7–20", RAMP[2]], ["21–44", RAMP[3]], ["45+", RAMP[4]], ["overdue", "var(--red)"]].map(([l, c]) => (
          <span key={l} className="flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{ background: c }} />{l}</span>
        ))}
      </div>
    </div>
  );
}
