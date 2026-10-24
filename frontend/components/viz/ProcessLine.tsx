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
 * With `delay` (projected delay per case), the one or two stations carrying the most delay are marked.
 */
export function ProcessLine({ rows, value, onChange, delay }: {
  rows: PendencyRow[]; value: StationId | null; onChange: (s: StationId | null) => void; delay?: Record<string, number>;
}) {
  const at = new Map<StationId, PendencyRow[]>(STATIONS.map((s) => [s.id, []]));
  rows.forEach((r) => at.get(stationOf(r))!.push(r));
  const stationDelay = new Map<StationId, number>(STATIONS.map((s) => [s.id, (at.get(s.id) ?? []).reduce((t, r) => t + (delay?.[r.id] ?? 0), 0)]));
  const hot = [...stationDelay.entries()].filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
  return (
    <div className="overflow-x-auto">
      <ol className="relative grid min-w-[760px] grid-cols-7" aria-label="Cases at each stage of the process">
        <span className="absolute left-[7%] right-[7%] top-[15px] h-[2px] bg-line" aria-hidden />
        {STATIONS.map((s) => {
          const list = [...at.get(s.id)!].sort((a, b) => b.days_in_stage - a.days_in_stage);
          const overdue = list.filter((r) => r.sla_status === "overdue").length;
          const on = value === s.id;
          const avg = list.length ? Math.round(list.reduce((t, r) => t + r.days_in_stage, 0) / list.length) : 0;
          const building = hot.includes(s.id) ? stationDelay.get(s.id)! : 0;
          return (
            <li key={s.id} className="relative">
              <button onClick={() => onChange(on ? null : s.id)} aria-pressed={on}
                aria-label={`${s.label}: ${list.length} cases, ${overdue} overdue${building ? `, ${building} days of projected delay` : ""}. ${on ? "Clear filter" : "Show these cases"}`}
                className={`group flex w-full flex-col items-center rounded-xl px-1.5 pb-3 pt-0 text-center transition-colors ${on ? "bg-brand-tint" : "hover:bg-surface-2"}`}>
                <span className={`relative z-[1] mt-[7px] flex h-[18px] w-[18px] items-center justify-center rounded-full ring-4 ring-surface transition-transform group-hover:scale-110 ${list.length ? (overdue ? "bg-danger" : "bg-brand") : "bg-line-strong"}`}>
                  {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className={`mt-2 text-[13px] font-medium ${on ? "text-brand-hover" : "text-ink"}`}>{s.label}</span>
                <span className="mono mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">{list.length}</span>
                <span className={`mt-1 h-[16px] text-[11.5px] ${overdue ? "font-medium text-danger-ink" : "text-ink-soft"}`}>
                  {overdue ? `${overdue} overdue` : list.length ? `about ${avg} days` : "none"}
                </span>
                <span className="mt-1.5 flex min-h-[10px] max-w-[110px] flex-wrap justify-center gap-[3px]" aria-hidden>
                  {list.slice(0, MAX_DOTS).map((r) => (
                    <span key={r.id} className="h-[7px] w-[7px] rounded-full" style={{ background: dotColour(r) }} title={`${r.ref_no}: ${r.days_in_stage} days at this step${r.sla_status === "overdue" ? ", overdue" : ""}`} />
                  ))}
                  {list.length > MAX_DOTS && <span className="mono text-[10px] leading-[7px] text-ink-soft">+{list.length - MAX_DOTS}</span>}
                </span>
                {building > 0 && (
                  <span className="mt-2 rounded-full bg-danger-tint px-2 py-px text-[11px] font-medium text-danger-ink">
                    delay building <span className="mono">+{building}d</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
