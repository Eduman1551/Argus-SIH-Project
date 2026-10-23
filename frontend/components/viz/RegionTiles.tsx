"use client";

import { RAMP } from "@/components/charts";

/** Rough geographic placement of the seven Regions on a 4 x 3 grid (column, row). */
const PLACE: Record<string, [number, number]> = {
  NR: [1, 0], NER: [3, 0], WR: [0, 1], CR: [1, 1], ER: [2, 1], SWR: [1, 2], SR: [2, 2],
};
const RED_RAMP = ["#fbe4e0", "#f4c3bb", "#e59487", "#d06353", "#c0392b"];

export interface RegionStat { region_id: number; code: string; region: string; cases: number; overdue: number }

/**
 * The seven Regions as tiles laid out roughly like the map. Shaded by cases in progress (teal) or by overdue
 * cases (red). Clicking a tile scopes the dashboard to that Region.
 */
export function RegionTiles({ data, metric, value, onChange }: {
  data: RegionStat[]; metric: "cases" | "overdue"; value: number | null; onChange: (id: number | null) => void;
}) {
  const ramp = metric === "cases" ? RAMP : RED_RAMP;
  const max = Math.max(1, ...data.map((d) => d[metric]));
  return (
    <div className="grid grid-cols-4 gap-2" style={{ gridTemplateRows: "repeat(3, minmax(74px, auto))" }} role="group" aria-label="Regions">
      {data.map((d) => {
        const [col, row] = PLACE[d.code] ?? [3, 2];
        const v = d[metric];
        const step = v === 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999));
        const bg = ramp[step];
        const dark = step >= 3;
        const on = value === d.region_id;
        return (
          <button key={d.region_id} onClick={() => onChange(on ? null : d.region_id)} aria-pressed={on}
            aria-label={`${d.region}: ${d.cases} cases in progress, ${d.overdue} overdue. ${on ? "Show all Regions" : "Show this Region"}`}
            style={{ gridColumn: col + 1, gridRow: row + 1, background: bg }}
            className={`flex flex-col justify-between rounded-xl p-2.5 text-left transition-transform hover:-translate-y-0.5 ${on ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "ring-1 ring-inset ring-black/5"} ${dark ? "text-white" : "text-ink"}`}>
            <span className="flex items-baseline justify-between gap-1">
              <span className="mono text-[11.5px] font-semibold opacity-80">{d.code}</span>
              <span className="mono text-[20px] font-semibold leading-none tracking-[-0.03em]">{v}</span>
            </span>
            <span className="text-[12px] leading-tight">
              {d.region}
              <span className={`block text-[11px] ${dark ? "text-white/85" : "text-ink/75"}`}>
                {metric === "cases" ? (d.overdue ? `${d.overdue} overdue` : "none overdue") : `of ${d.cases} cases`}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
