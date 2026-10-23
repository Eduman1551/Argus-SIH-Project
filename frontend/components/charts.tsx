"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/** Chart palette: a teal ramp for normal data; amber and red only for exceptions (due soon, overdue). */
export const C = {
  ink: "#17201f", soft: "#5f6b68", line: "#e4e2da", grid: "#ecebe5",
  t1: "#d5ebe7", t2: "#a8d4cc", t3: "#6fb3a8", t4: "#2f857d", t5: "#0f5e5a",
  slate: "#a9b3b0", amber: "#b7791f", red: "#c0392b",
};
export const RAMP = [C.t1, C.t2, C.t3, C.t4, C.t5];
const AXIS = { fontSize: 12, fill: C.soft, fontFamily: "var(--font-geist-sans)" };
const TOOLTIP = {
  contentStyle: { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 12.5, color: C.ink, boxShadow: "0 4px 16px rgba(23,32,31,.08)" },
  cursor: { fill: "rgba(15,94,90,0.06)" },
};
const LABEL = { fontSize: 12, fill: C.ink, fontWeight: 600, fontFamily: "var(--font-geist-mono)" };

export function StageBars({ data }: { data: { name: string; cases: number; overdue: number }[] }) {
  // `cap` is a hairline segment on top of each stack that carries the total label
  const rows = data.map((d) => ({ ...d, onTime: d.cases - d.overdue, cap: 0.001 }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={rows} margin={{ top: 18, right: 8, left: -12, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: C.line }} interval={0} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false}
          label={{ value: "Cases", angle: -90, position: "insideLeft", offset: 22, style: AXIS }} />
        <Tooltip {...TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12, color: C.soft }} />
        <Bar dataKey="onTime" name="Within time" stackId="a" fill={C.t4} maxBarSize={56} />
        <Bar dataKey="overdue" name="Overdue" stackId="a" fill={C.red} maxBarSize={56} />
        <Bar dataKey="cap" stackId="a" fill="transparent" legendType="none" isAnimationActive={false} maxBarSize={56}>
          <LabelList dataKey="cases" position="top" style={LABEL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AgeingBars({ data, height = 220 }: { data: { bucket: string; cases: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -18, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="bucket" tick={{ ...AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} interval={0}
          tickFormatter={(v: string) => v.replace(/ days$/, "d").replace(/^Over (\d+)d$/, "$1d+")}
          label={{ value: "Days since submission", position: "insideBottom", offset: -2, style: AXIS }} height={42} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="cases" name="Cases" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((_, i) => <Cell key={i} fill={RAMP[Math.min(i + 1, RAMP.length - 1)]} />)}
          <LabelList dataKey="cases" position="top" style={LABEL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RegionBars({ data }: { data: { region: string; cases: number; overdue: number }[] }) {
  const rows = data.map((d) => ({ ...d, onTime: d.cases - d.overdue, cap: 0.001 }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 34 + 40)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke={C.grid} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={{ stroke: C.line }} />
        <YAxis type="category" dataKey="region" tick={AXIS} tickLine={false} axisLine={false} width={96} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="onTime" name="Within time" stackId="r" fill={C.t3} maxBarSize={22} />
        <Bar dataKey="overdue" name="Overdue" stackId="r" fill={C.red} maxBarSize={22} />
        <Bar dataKey="cap" stackId="r" fill="transparent" isAnimationActive={false} maxBarSize={22}>
          <LabelList dataKey="cases" position="right" style={LABEL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StageTimeBars({ data }: { data: { name: string; avg_institution_days: number; avg_aicte_days: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: C.line }} interval={0} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false}
          label={{ value: "Average days", angle: -90, position: "insideLeft", offset: 18, style: AXIS }} />
        <Tooltip {...TOOLTIP} formatter={(v) => `${v} days`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="avg_aicte_days" name="Waiting on AICTE / committee" stackId="t" fill={C.t4} maxBarSize={56} />
        <Bar dataKey="avg_institution_days" name="Waiting on institution" stackId="t" fill={C.slate} radius={[4, 4, 0, 0]} maxBarSize={56} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Two-part horizontal bar: waiting on AICTE/committees vs on the institution (hatched, like the SLA bar). */
export function SplitBar({ institution, aicte, unit = "days" }: { institution: number; aicte: number; unit?: string }) {
  const total = institution + aicte || 1;
  const pi = Math.round((institution / total) * 100);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line" role="img"
        aria-label={`Waiting on institution ${institution} ${unit}, on AICTE and committees ${aicte} ${unit}`}>
        <div className="bg-brand" style={{ width: `${100 - pi}%` }} />
        <div className="hatch" style={{ width: `${pi}%` }} />
      </div>
      <div className="mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12.5px] text-ink-soft">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand" />AICTE / committees <b className="mono font-medium text-ink">{aicte}</b> {unit} ({100 - pi}%)</span>
        <span className="flex items-center gap-1.5"><span className="hatch inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-line" />Institution <b className="mono font-medium text-ink">{institution}</b> {unit} ({pi}%)</span>
      </div>
    </div>
  );
}
