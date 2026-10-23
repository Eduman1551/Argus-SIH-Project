"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardCheck, FileClock, FilePlus2, MessageSquareWarning } from "lucide-react";
import { Card, DueCell, Empty, ErrorNote, HelpBox, LinkButton, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Stat, Table } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dueText, fmtDate } from "@/lib/format";
import { DECISION_TEXT } from "@/lib/labels";
import { useApp } from "@/lib/store";
import type { TrackedDoc, Undertaking } from "@/lib/types";

interface Home {
  applications: { id: number; ref_no: string; type_name: string; programme: string; status: string; decision: string | null;
    stage_name: string; substatus_text: string; sla_status: string | null; due_date: string | null; waiting_on: string | null }[];
  pending_actions: { kind: string; title: string; due_date: string; days_to_due: number; link: string }[];
  deficiencies: { id: number; application_id: number; ref_no: string; reason: string; response_due_at: string; days_to_due: number; raised_by: string }[];
  visits: { id: number; ref_no: string; application_id: number; status: string; visit_date: string | null }[];
  undertakings: Undertaking[]; evidence_waiting: Undertaking[]; documents_attention: TrackedDoc[];
  counts: { applications: number; in_progress: number; actions: number; overdue_actions: number };
}

const ICON: Record<string, React.ReactNode> = {
  deficiency: <MessageSquareWarning size={17} />, undertaking: <ClipboardCheck size={17} />, document: <FileClock size={17} />,
};

export function DocState({ state, level }: { state: string; level?: number | null }) {
  if (level) return <Stamp tone="escalated" level={level} />;
  if (state === "expired") return <Stamp tone="overdue">Expired</Stamp>;
  if (state === "expiring_soon") return <Stamp tone="soon">Expiring soon</Stamp>;
  if (state === "renewal_submitted") return <Stamp tone="waiting">Renewal submitted</Stamp>;
  return <Stamp tone="ok">Valid</Stamp>;
}

export function UndertakingState({ u }: { u: Undertaking }) {
  if (u.escalation_level) return <span className="inline-flex flex-wrap gap-1"><Stamp tone="escalated" level={u.escalation_level} /><Stamp tone="overdue" /></span>;
  if (u.state === "overdue") return <Stamp tone="overdue" />;
  if (u.state === "due_soon") return <Stamp tone="soon">Due soon</Stamp>;
  if (u.state === "awaiting_verification") return <Stamp tone="waiting">Awaiting verification</Stamp>;
  if (u.state === "closed") return <Stamp tone="closed">Verified · closed</Stamp>;
  if (u.status === "resubmission_requested") return <Stamp tone="soon">Resubmit</Stamp>;
  return <Stamp tone="neutral">Open</Stamp>;
}

export default function InstitutionHome() {
  const user = useApp((s) => s.user)!;
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Home>("/api/dashboard");
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;

  return (
    <div>
      <PageHeader kicker="Institution home" title={user.institution_name ?? "My institution"}
        description="Your applications, what you need to do next, and the deadlines Argus is watching for you."
        action={<LinkButton kind="primary" href="/applications?new=1"><FilePlus2 size={16} /> New application</LinkButton>} />
      <HelpBox id="inst-home">
        Work through <b>Pending actions</b> from the top: they are sorted by due date. Argus reminds you before each deadline and,
        if a deadline passes, the item is escalated to AICTE officers.
      </HelpBox>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Applications in progress" value={data.counts.in_progress} hint={`${data.counts.applications} in total`} href="/applications" />
        <Stat label="Pending actions" value={data.counts.actions} tone={data.counts.actions ? "ochre" : "olive"} hint="Things you need to do" />
        <Stat label="Overdue actions" value={data.counts.overdue_actions} tone={data.counts.overdue_actions ? "red" : "olive"} hint="Past their due date" />
        <Stat label="Documents needing attention" value={data.documents_attention.length} tone={data.documents_attention.some((d) => d.state === "expired") ? "red" : "ink"} href="/documents" hint="Expired or expiring soon" />
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card title="Pending actions" subtitle="Most urgent first" pad={false}>
          {data.pending_actions.length ? (
            <ul className="divide-y divide-line/70">
              {data.pending_actions.map((a, i) => (
                <li key={i}>
                  <Link href={a.link} className="flex items-start gap-3 px-4 py-3 text-ink no-underline hover:bg-paper-2/50">
                    <span className={`mt-0.5 ${a.days_to_due < 0 ? "text-brand" : "text-ochre-ink"}`}>{ICON[a.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium leading-snug">{a.title}</span>
                      <span className="text-[12.5px] text-ink-soft">Due {fmtDate(a.due_date)} · {dueText(a.days_to_due)}</span>
                    </span>
                    {a.days_to_due < 0 ? <Stamp tone="overdue" /> : a.kind === "document" ? <Stamp tone="soon">Expiring soon</Stamp>
                      : a.days_to_due <= 7 ? <Stamp tone="soon">Due soon</Stamp> : <Stamp tone="neutral">Upcoming</Stamp>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="Nothing waiting on you." >Argus will remind you before any deadline.</Empty>}
        </Card>

        <Card title="Expert visits" subtitle="Your EVC schedule">
          {data.visits.length ? (
            <ul className="space-y-2">
              {data.visits.map((v) => (
                <li key={v.id} className="flex items-center gap-3 rounded-md border border-line bg-paper/50 px-3 py-2">
                  <CalendarDays size={18} className="text-brand" />
                  <div className="min-w-0 flex-1 text-[14px]">
                    <Link href={`/applications/${v.application_id}`} className="font-semibold no-underline">{v.ref_no}</Link>
                    <div className="text-[12.5px] text-ink-soft">
                      {v.visit_date ? `Visit on ${fmtDate(v.visit_date)}` : "Visit date not fixed yet"}
                    </div>
                  </div>
                  {v.status === "reviewed" ? <Stamp tone="closed">Done</Stamp> : v.visit_date ? <Stamp tone="info">Scheduled</Stamp> : <Stamp tone="neutral">Planning</Stamp>}
                </li>
              ))}
            </ul>
          ) : <Empty title="No expert visits planned." />}
        </Card>
      </div>

      <Card title="My applications" subtitle="Current stage and the next due date" pad={false} className="mb-5">
        <Table>
          <thead><tr><th>Reference</th><th>Type</th><th>Current stage</th><th>Next due</th><th>Status</th></tr></thead>
          <tbody>
            {data.applications.map((a) => (
              <tr key={a.id} className="row-link" onClick={() => router.push(`/applications/${a.id}`)}>
                <td><Link href={`/applications/${a.id}`} className="font-semibold no-underline">{a.ref_no}</Link><div className="text-[12.5px] text-ink-soft">{a.programme}</div></td>
                <td>{a.type_name}</td>
                <td>{a.status === "decided" ? DECISION_TEXT[a.decision ?? ""] : <>{a.stage_name}<div className="text-[12.5px] text-ink-soft">{a.substatus_text}</div></>}</td>
                <td><DueCell date={a.due_date} days={null} fmt={fmtDate} /></td>
                <td>{a.status === "decided" ? <Stamp tone="closed">Decided</Stamp> : <SlaStamp status={a.sla_status} waitingOn={a.waiting_on} />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Open undertakings" subtitle="Time-bound conditions from your approvals" action={<LinkButton small href="/undertakings">All undertakings</LinkButton>} pad={false}>
          {data.undertakings.length ? (
            <Table>
              <thead><tr><th>Condition</th><th>Due</th><th>State</th></tr></thead>
              <tbody>
                {data.undertakings.slice(0, 6).map((u) => (
                  <tr key={u.id}><td className="max-w-[340px]">{u.condition_text}<div className="text-[12px] text-ink-soft">{u.ref_no}</div></td>
                    <td><DueCell date={u.due_date} days={u.days_to_due} fmt={fmtDate} /></td><td><UndertakingState u={u} /></td></tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="No open undertakings." />}
        </Card>
        <Card title="Documents expiring soon" subtitle="Lease and other tracked documents" action={<LinkButton small href="/documents">All documents</LinkButton>} pad={false}>
          {data.documents_attention.length ? (
            <Table>
              <thead><tr><th>Document</th><th>Expires</th><th>State</th></tr></thead>
              <tbody>
                {data.documents_attention.map((d) => (
                  <tr key={d.id}><td>{d.title}<div className="text-[12px] text-ink-soft">{d.issued_by}</div></td>
                    <td><DueCell date={d.expires_on} days={d.days_to_expiry} fmt={fmtDate} /></td><td><DocState state={d.state} level={d.escalation_level} /></td></tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="All documents are valid." />}
          {data.evidence_waiting.length > 0 && (
            <div className="border-t border-line/70 px-4 py-2.5 text-[13.5px] text-ink-soft">
              {data.evidence_waiting.length} evidence submission(s) are waiting for AICTE verification.
            </div>
          )}
        </Card>
      </div>
      <NextStep href="/undertakings" label="upload evidence for undertakings" />
    </div>
  );
}
