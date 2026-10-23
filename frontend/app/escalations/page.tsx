"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Flag } from "lucide-react";
import { EscalationLadder, nextStep, useEscalationRules, type Rung } from "@/components/viz/EscalationLadder";
import { daysBetween } from "@/components/viz/SlaBar";
import {
  Card, Drawer, Empty, ErrorNote, HelpBox, KeyVal, LinkButton, NextStep, PageHeader, PageSkeleton, Stamp, Table, Tabs, useRowNav,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ENTITY_TEXT } from "@/lib/labels";
import { useApp } from "@/lib/store";

interface Esc {
  id: number; entity_type: string; entity_id: number; level: number; due_date: string; escalated_at: string; status: string;
  resolved_at: string | null; title: string; application_id: number | null; ref_no: string | null; institution: string | null;
  region: string | null; target: string | null; level_title: string; days_overdue: number;
}
interface Level { level: number; title: string; target: string }
interface Item { key: string; top: Esc; all: Esc[]; level: number; rungs: Rung[]; next: { level: number; date: string } | null }

/** "Escalated to L2: Bureau Officer: Fire safety NOC" -> "Fire safety NOC" (the level is shown separately). */
const itemName = (e: Esc) => e.title.replace(/^Escalated to L\d: .+?: /, "");

function link(e: Esc) {
  if (e.entity_type === "undertaking") return "/compliance";
  if (e.entity_type === "document") return "/validity";
  return e.application_id ? `/applications/${e.application_id}` : "/";
}

/** One row per overdue item, with the escalations it has collected so far as ladder rungs. */
function group(open: Esc[], levels: Level[], rules: ReturnType<typeof useEscalationRules>): Item[] {
  const map = new Map<string, Esc[]>();
  open.forEach((e) => { const k = `${e.entity_type}:${e.entity_id}:${e.due_date}`; map.set(k, [...(map.get(k) ?? []), e]); });
  return [...map.entries()].map(([key, all]) => {
    const level = Math.max(...all.map((e) => e.level));
    const top = all.find((e) => e.level === level)!;
    const rungs = levels.map((l) => {
      const hit = all.find((e) => e.level === l.level);
      return { level: l.level, title: l.title, reachedAt: hit?.escalated_at ?? null, to: hit?.target ?? l.title.replace(/^L\d:\s*/, "") };
    });
    return { key, top, all, level, rungs, next: nextStep(top.entity_type, top.due_date, level, rules) };
  }).sort((a, b) => b.level - a.level || b.top.days_overdue - a.top.days_overdue);
}

function Pips({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Reached level ${level} of 3`}>
      {[1, 2, 3].map((l) => (
        <span key={l} className={`mono flex h-[18px] w-[24px] items-center justify-center rounded text-[10.5px] font-semibold ${l <= level ? "bg-esc text-white" : "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line"}`}>L{l}</span>
      ))}
    </span>
  );
}

export default function EscalationsPage() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const rules = useEscalationRules();
  const [all, setAll] = useState(user.official_kind !== "regional");
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ open: Esc[]; resolved: Esc[]; levels: Level[] }>(
    user.role === "official" ? `/api/escalations${all ? "?all_regions=true" : ""}` : null);
  const items = useMemo(() => data ? group(data.open, data.levels, rules) : [], [data, rules]);
  const onOpen = useCallback((i: number) => setOpen(items[i]?.key ?? null), [items]);
  const rowProps = useRowNav(items.length, onOpen);

  if (user.role !== "official") return <ErrorNote error={{ message: "Escalations are visible to officials." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const sel = items.find((i) => i.key === open);

  return (
    <div>
      <PageHeader crumbs={[{ label: "Monitoring" }, { label: "Escalations" }]} title="Escalations"
        description="Overdue items that have gone up the chain. Each clears automatically on the next check once the item is completed."
        action={user.official_kind === "regional" ? (
          <Tabs className="" value={all ? "all" : "mine"} onChange={(v) => setAll(v === "all")}
            tabs={[{ id: "mine", label: "My Region" }, { id: "all", label: "All Regions" }]} />) : undefined} />
      <HelpBox id="escalations">The chain and the number of days before each level are set on the Rules page. Click an item to see who was alerted at each level and when the next level is due.</HelpBox>

      <div className="surface enter mb-6 grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0" aria-label="Open items by highest level reached">
        {[...data.levels].reverse().map((l) => {
          const n = items.filter((i) => i.level === l.level).length;
          return (
            <div key={l.level} className="flex items-center gap-4 px-4 py-3.5">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${n ? "bg-esc text-white" : "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line"}`}><Flag size={17} /></span>
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-ink-soft">Level {l.level} · {l.title.replace(/^L\d:\s*/, "")}</div>
                <div className={`mono text-[24px] font-semibold leading-tight tracking-[-0.02em] ${n ? "text-esc" : "text-ink"}`}>{n}</div>
                <div className="truncate text-[12px] text-ink-soft">{n === 1 ? "item" : "items"} at this level</div>
              </div>
            </div>
          );
        })}
      </div>

      <Card title="Open escalations" subtitle="Highest level first, then most overdue. Click a row to see its ladder." pad={false} className="mb-6">
        {items.length ? (
          <Table minWidth={980}>
            <thead><tr><th>Item</th><th>Institution</th><th>Was due</th><th className="num">Days late</th><th>Reached</th><th>Next level</th></tr></thead>
            <tbody>
              {items.map((it, i) => {
                const e = it.top;
                const left = it.next && today ? daysBetween(today, it.next.date) : null;
                return (
                  <tr key={it.key} {...rowProps(i)} aria-label={`Show ladder for ${itemName(e)}`}>
                    <td className="max-w-[340px]"><div className="font-medium leading-snug">{itemName(e)}</div><div className="text-[12px] text-ink-soft">{ENTITY_TEXT[e.entity_type]}{e.ref_no ? <> · <span className="mono">{e.ref_no}</span></> : ""}</div></td>
                    <td>{e.institution}<div className="text-[12px] text-ink-soft">{e.region}</div></td>
                    <td className="mono">{fmtDate(e.due_date)}</td>
                    <td className="num mono font-semibold text-danger-ink">{e.days_overdue}</td>
                    <td><Pips level={it.level} /><div className="mt-1 text-[12px] text-ink-soft">{e.target}</div></td>
                    <td>{it.level >= 3 ? <span className="text-[12.5px] text-ink-soft">Top of the chain</span>
                      : it.next ? <span className="text-[12.5px]"><b className="font-medium text-esc">L{it.next.level}</b> <span className="mono">{left != null && left <= 0 ? "today" : `in ${left} d`}</span><div className="mono text-[11.5px] text-ink-soft">{fmtDate(it.next.date)}</div></span>
                      : <span className="text-[12.5px] text-ink-soft">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : <Empty title="No open escalations.">Advance the clock from the date chip to see overdue items escalate.</Empty>}
      </Card>

      <Card title="Recently resolved" subtitle="Cleared once the overdue item was completed" pad={false}>
        {data.resolved.length ? (
          <Table>
            <thead><tr><th>Level</th><th>Item</th><th>Institution</th><th>Resolved</th></tr></thead>
            <tbody>{data.resolved.map((e) => (
              <tr key={e.id}><td><Stamp tone="closed">L{e.level} resolved</Stamp></td><td className="max-w-[360px]">{itemName(e)}</td><td>{e.institution}</td><td className="mono">{fmtDate(e.resolved_at)}</td></tr>
            ))}</tbody>
          </Table>
        ) : <Empty title="Nothing resolved yet." />}
      </Card>

      <Drawer open={!!sel} onClose={() => setOpen(null)} title={sel ? itemName(sel.top) : ""}
        subtitle={sel ? <>{ENTITY_TEXT[sel.top.entity_type]} · {sel.top.institution}</> : undefined}
        footer={sel && <LinkButton kind="primary" href={link(sel.top)}>Open the item <ArrowRight size={15} /></LinkButton>}>
        {sel && (
          <div className="space-y-5">
            <KeyVal items={[
              ["Was due", <span key="d" className="mono">{fmtDate(sel.top.due_date)}</span>],
              ["Days late", <span key="l" className="mono font-medium text-danger-ink">{sel.top.days_overdue}</span>],
              ["Region", sel.top.region ?? "–"],
              ...(sel.top.ref_no ? [["Case", <span key="c" className="mono">{sel.top.ref_no}</span>] as [string, React.ReactNode]] : []),
            ]} />
            <div>
              <div className="mb-2 text-[12.5px] font-medium text-ink-soft">Escalation ladder</div>
              <EscalationLadder rungs={sel.rungs} next={sel.next} today={today} />
            </div>
          </div>
        )}
      </Drawer>
      <NextStep href="/reports" label="reports" />
    </div>
  );
}
