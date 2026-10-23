"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const C = {
  ink: "#3B2A1E", soft: "#6B5744", line: "#D6C3A3", red: "#B3262D", deep: "#7E1B22",
  tan1: "#E3CFA8", tan2: "#CDAE7E", tan3: "#B0855A", brown: "#8C5A3C", olive: "#5B7B3A", ochre: "#B7791F",
};
const AXIS = { fontSize: 12, fill: C.soft };
const TOOLTIP = {
  contentStyle: { background: "#FBF6EC", border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 13, color: C.ink },
  cursor: { fill: "rgba(234,220,195,0.5)" },
};

export function StageBars({ data }: { data: { name: string; cases: number; overdue: number }[] }) {
  // `cap` is a hairline segment on top of each stack that carries the total label
  const rows = data.map((d) => ({ ...d, onTime: d.cases - d.overdue, cap: 0.001 }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={rows} margin={{ top: 18, right: 8, left: -12, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={C.line} strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: C.line }} interval={0} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false}
          label={{ value: "Cases", angle: -90, position: "insideLeft", offset: 22, style: AXIS }} />
        <Tooltip {...TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12, color: C.soft }} />
        <Bar dataKey="onTime" name="Within time" stackId="a" fill={C.tan3} maxBarSize={72} />
        <Bar dataKey="overdue" name="Overdue" stackId="a" fill={C.red} maxBarSize={72} />
        <Bar dataKey="cap" stackId="a" fill="transparent" legendType="none" isAnimationActive={false} maxBarSize={72}>
          <LabelList dataKey="cases" position="top" style={{ fontSize: 12, fill: C.ink, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const HEAT = [C.tan1, C.tan2, C.tan3, C.brown, C.deep];

export function AgeingBars({ data }: { data: { bucket: string; cases: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -12, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={C.line} strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tick={{ ...AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} interval={0}
          label={{ value: "Age since submission", position: "insideBottom", offset: -2, style: AXIS }} height={42} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="cases" name="Cases" radius={[3, 3, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={HEAT[Math.min(i, HEAT.length - 1)]} />)}
          <LabelList dataKey="cases" position="top" style={{ fontSize: 12, fill: C.ink, fontWeight: 600 }} />
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
        <CartesianGrid horizontal={false} stroke={C.line} strokeDasharray="3 3" />
        <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={{ stroke: C.line }} />
        <YAxis type="category" dataKey="region" tick={AXIS} tickLine={false} axisLine={false} width={96} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="onTime" name="Within time" stackId="r" fill={C.tan2} maxBarSize={26} />
        <Bar dataKey="overdue" name="Overdue" stackId="r" fill={C.red} maxBarSize={26} />
        <Bar dataKey="cap" stackId="r" fill="transparent" isAnimationActive={false} maxBarSize={26}>
          <LabelList dataKey="cases" position="right" style={{ fontSize: 12, fill: C.ink, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StageTimeBars({ data }: { data: { name: string; avg_institution_days: number; avg_aicte_days: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={C.line} strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: C.line }} interval={0} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false}
          label={{ value: "Average days", angle: -90, position: "insideLeft", offset: 18, style: AXIS }} />
        <Tooltip {...TOOLTIP} formatter={(v) => `${v} days`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="avg_aicte_days" name="Waiting on AICTE / committee" stackId="t" fill={C.tan3} />
        <Bar dataKey="avg_institution_days" name="Waiting on institution" stackId="t" fill={C.ochre} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Two-part horizontal bar: waiting on institution vs on AICTE/committees. */
export function SplitBar({ institution, aicte, unit = "days" }: { institution: number; aicte: number; unit?: string }) {
  const total = institution + aicte || 1;
  const pi = Math.round((institution / total) * 100);
  return (
    <div>
      <div className="flex h-5 overflow-hidden rounded border border-line" role="img"
        aria-label={`Waiting on institution ${institution} ${unit}, on AICTE and committees ${aicte} ${unit}`}>
        <div style={{ width: `${100 - pi}%`, background: C.tan3 }} />
        <div style={{ width: `${pi}%`, background: C.ochre }} />
      </div>
      <div className="mt-2 flex justify-between text-[13px]">
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.tan3 }} />AICTE / committees: <b>{aicte}</b> {unit} ({100 - pi}%)</span>
        <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.ochre }} />Institution: <b>{institution}</b> {unit} ({pi}%)</span>
      </div>
    </div>
  );
}
