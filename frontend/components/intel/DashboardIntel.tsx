"use client";

import Link from "next/link";
import { ArrowRight, TrendingUp } from "lucide-react";
import { RiskPill } from "@/components/status";
import { Card, Empty, Stamp } from "@/components/ui";
import type { IntelOverview } from "@/lib/types";

/** Band counts as small pills (word and colour, never colour alone). */
export function BandCounts({ counts }: { counts: IntelOverview["counts"] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Stamp tone="overdue">High <span className="mono">{counts.high}</span></Stamp>
      <Stamp tone="soon">Medium <span className="mono">{counts.medium}</span></Stamp>
      <Stamp tone="ok">Low <span className="mono">{counts.low}</span></Stamp>
    </span>
  );
}

/** Top recommended actions waiting for an official, most at risk first. */
export function NeedsAttention({ data }: { data: IntelOverview }) {
  return (
    <Card title="Needs attention" subtitle="Cases at risk with a recommended action" pad={false}
      action={<BandCounts counts={data.counts} />}>
      {data.needs_attention.length ? (
        <ul className="divide-y divide-line">
          {data.needs_attention.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-4 py-2.5">
              <RiskPill band={w.band} score={w.score} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]"><span className="mono font-medium">{w.ref_no}</span>
                  <span className="text-ink-soft"> · {w.institution}</span></div>
                <div className="truncate text-[12px] text-ink-soft">{w.rule_label}: {w.action_text.charAt(0).toLowerCase() + w.action_text.slice(1)}</div>
              </div>
              <Link href={`/applications/${w.application_id}#recommendation`}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-line-strong px-2.5 text-[12.5px] font-medium text-ink no-underline hover:bg-surface-2">
                Review <ArrowRight size={13} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty title="Nothing needs attention.">No case at risk has a recommended action right now.</Empty>}
    </Card>
  );
}

/** Where projected delay is concentrated, top 3, in one sentence each. */
export function DelaysBuilding({ data }: { data: IntelOverview }) {
  return (
    <Card title="Where delays are building" subtitle="Grouped by stage and Region, officer and institution">
      {data.bottlenecks.length ? (
        <ol className="space-y-3">
          {data.bottlenecks.map((b, i) => (
            <li key={b.label} className="flex gap-3 text-[13px]">
              <span className={`mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${i === 0 ? "bg-danger-tint text-danger-ink" : "bg-warn-tint text-warn-ink"}`}>{i + 1}</span>
              <span className="leading-snug">{b.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft"><TrendingUp size={15} /> No delay is building up anywhere right now.</div>
      )}
    </Card>
  );
}
