"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { CalendarDays, ClipboardCheck, FileClock, FilePlus2, MessageSquareWarning } from "lucide-react";
import { CasePreview } from "@/components/case/CasePreview";
import { HeatCalendar, type CalEvent } from "@/components/viz/HeatCalendar";
import { SlaBar, rowSla, type StageWindow } from "@/components/viz/SlaBar";
import {
  Callout, Card, DueCell, Empty, ErrorNote, HelpBox, LinkButton, Metrics, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Stat,
  Table, useRowNav,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { dueText, fmtDate } from "@/lib/format";
import { DECISION_TEXT } from "@/lib/labels";
import { useApp } from "@/lib/store";
import type { TrackedDoc, Undertaking } from "@/lib/types";

export { DocState, UndertakingState } from "@/components/status";

interface HomeApp extends StageWindow {
  id: number; ref_no: string; type_name: string; programme: string; status: string; decision: string | null;
  stage_name: string; substatus_text: string; sla_status: string | null; due_date: string | null; days_to_due: number | null;
  waiting_on: string | null;
}
interface Home {
  applications: HomeApp[];
  pending_actions: { kind: string; title: string; due_date: string; days_to_due: number; link: string }[];
  visits: { id: number; ref_no: string; application_id: number; status: string; visit_date: string | null }[];
  undertakings: Undertaking[]; evidence_waiting: Undertaking[]; documents_attention: TrackedDoc[];
  counts: { applications: number; in_progress: number; actions: number; overdue_actions: number };
  blockers: { application_id: number; ref_no: string; due_date: string | null; days_to_due: number | null }[];
}

const ICON: Record<string, React.ReactNode> = {
  deficiency: <MessageSquareWarning size={16} />, undertaking: <ClipboardCheck size={16} />, document: <FileClock size={16} />,
};

export default function InstitutionHome() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const { data, error, loading, reload } = useApi<Home>("/api/dashboard");
  const unds = useApi<{ rows: Undertaking[] }>("/api/undertakings");
  const docs = useApi<{ rows: TrackedDoc[] }>("/api/tracked-documents");
  const [preview, setPreview] = useState<number | null>(null);

  const events = useMemo<CalEvent[]>(() => [
    ...(unds.data?.rows ?? []).filter((u) => u.state !== "closed").map((u) => ({ date: u.due_date, kind: "undertaking" as const, label: u.condition_text, href: "/undertakings" })),
    ...(docs.data?.rows ?? []).filter((d) => d.status !== "renewal_submitted").map((d) => ({ date: d.expires_on, kind: "document" as const, label: d.title, href: "/documents" })),
    ...(data?.visits ?? []).filter((v) => v.visit_date && v.status !== "reviewed").map((v) => ({ date: v.visit_date!, kind: "evc" as const, label: `Visit for ${v.ref_no}`, href: `/applications/${v.application_id}` })),
  ], [unds.data, docs.data, data?.visits]);

  const apps = data?.applications ?? [];
  const open = useCallback((i: number) => setPreview(apps[i]?.id ?? null), [apps]);
  const rowProps = useRowNav(apps.length, open);

  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Institution" }, { label: "Home" }]} title={user.institution_name ?? "My institution"}
        description="Your applications and what to do next."
        action={<LinkButton kind="primary" href="/applications?new=1"><FilePlus2 size={15} /> New application</LinkButton>} />
      <HelpBox id="inst-home">
        Start at the top of <b>What needs you</b>. Argus reminds you before each deadline.
      </HelpBox>

      {data.blockers.length > 0 && (
        <Callout kind="warning" title="Your reply is needed to avoid delay">
          {data.blockers.map((b, i) => (
            <span key={b.application_id}>{i > 0 && "; "}
              <Link href={`/applications/${b.application_id}`} className="mono font-medium">{b.ref_no}</Link>
              {b.due_date && <> — reply by <span className="mono">{fmtDate(b.due_date)}</span> ({dueText(b.days_to_due)})</>}
            </span>
          ))}.
        </Callout>
      )}
      <Metrics>
        <Stat label="In progress" value={data.counts.in_progress} hint={`${data.counts.applications} applications in total`} href="/applications" />
        <Stat label="Waiting on you" value={data.counts.actions} tone={data.counts.actions ? "warn" : "good"} hint="Things to do" />
        <Stat label="Overdue" value={data.counts.overdue_actions} tone={data.counts.overdue_actions ? "red" : "good"} hint="Past their due date" />
        <Stat label="Documents to renew" value={data.documents_attention.filter((d) => d.state !== "renewal_submitted").length}
          tone={data.documents_attention.some((d) => d.state === "expired") ? "red" : "ink"} hint="Expired or expiring soon" href="/documents" />
      </Metrics>

      <div className="mb-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card title="What needs you" subtitle="Most urgent first" pad={false}>
          {data.pending_actions.length ? (
            <ul className="divide-y divide-line">
              {data.pending_actions.map((a, i) => (
                <li key={i}>
                  <Link href={a.link} className="grid grid-cols-[84px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-ink no-underline transition-colors hover:bg-surface-2">
                    <span className="mono pt-0.5 text-[12.5px] text-ink-soft">{fmtDate(a.due_date).slice(0, 6)}<span className="block text-[11.5px]">{dueText(a.days_to_due)}</span></span>
                    <span className="flex min-w-0 gap-2.5">
                      <span className={`mt-0.5 shrink-0 ${a.days_to_due < 0 ? "text-danger" : "text-ink-soft"}`}>{ICON[a.kind]}</span>
                      <span className="text-[13.5px] leading-snug">{a.title}</span>
                    </span>
                    {a.days_to_due < 0 ? <Stamp tone="overdue" /> : a.kind === "document" ? <Stamp tone="soon">Expiring soon</Stamp>
                      : a.days_to_due <= 7 ? <Stamp tone="soon">Due soon</Stamp> : <Stamp tone="neutral">Upcoming</Stamp>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="Nothing is waiting on you.">Argus will remind you before any deadline.</Empty>}
        </Card>

        <Card title="Next 90 days" subtitle="Undertakings, document expiries and expert visits">
          {today ? <HeatCalendar today={today} events={events} cell={15} /> : null}
          {data.visits.filter((v) => v.status !== "reviewed").length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
              {data.visits.filter((v) => v.status !== "reviewed").map((v) => (
                <li key={v.id} className="flex items-center gap-2 text-[13px]">
                  <CalendarDays size={14} className="text-brand" />
                  <Link href={`/applications/${v.application_id}`} className="mono no-underline">{v.ref_no}</Link>
                  <span className="text-ink-soft">{v.visit_date ? `visit on ${fmtDate(v.visit_date)}` : "visit date not fixed yet"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="My applications" subtitle="Click a row for details" pad={false} className="mb-6">
        <Table minWidth={860}>
          <thead><tr><th>Application</th><th>Stage</th><th style={{ width: 160 }}>Time used</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {apps.map((a, i) => {
              const sla = today ? rowSla(a, today) : null;
              return (
                <tr key={a.id} {...rowProps(i)} aria-label={`Preview ${a.ref_no}`}>
                  <td><span className="mono font-medium text-brand">{a.ref_no}</span><div className="max-w-[220px] truncate text-[12px] text-ink-soft">{a.programme}</div></td>
                  <td>{a.status === "decided" ? DECISION_TEXT[a.decision ?? ""] : <>{a.stage_name}<div className="text-[12px] text-ink-soft">{a.substatus_text}</div></>}</td>
                  <td>{sla ? <SlaBar {...sla} compact /> : <span className="text-ink-soft">–</span>}</td>
                  <td><DueCell date={a.due_date} days={a.days_to_due} fmt={fmtDate} /></td>
                  <td>{a.status === "decided" ? <Stamp tone="closed">Decided</Stamp> : <SlaStamp status={a.sla_status} days={a.days_to_due} waitingOn={a.waiting_on} solid />}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <CasePreview appId={preview} onClose={() => setPreview(null)} />
      <NextStep href="/undertakings" label="upload evidence for undertakings" />
    </div>
  );
}
