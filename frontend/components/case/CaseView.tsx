"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRightLeft, CalendarCheck2, Check, CheckCircle2, CornerUpLeft, FileSignature, Gavel, Hourglass, MessageSquareWarning, PencilLine, RefreshCw, Send, Sparkles, Undo2, UserRoundCog, Users } from "lucide-react";
import { FileList, FilePicker, type FileRow } from "@/components/Files";
import Timeline, { type AuditEntry } from "@/components/Timeline";
import { Button, Card, DraftLabel, DueCell, ErrorNote, Field, KeyVal, Modal, NextStep, PageHeader, PageSkeleton, SlaStamp, Stamp, Table } from "@/components/ui";
import { UndertakingState } from "@/components/home/InstitutionHome";
import { act, api, useApi } from "@/lib/api";
import { addDays, dueText, fmtDate, fmtDateTime } from "@/lib/format";
import { DECISION_TEXT, RECOMMENDATION_TEXT, REPORT_OUTCOME_TEXT, STAGE_NAME, WAITING_TEXT } from "@/lib/labels";
import { useApp, type SessionUser } from "@/lib/store";
import type { Member, PendencyRow, Undertaking } from "@/lib/types";

/* ---------------------------------------------------------------- payload */
interface RouteStep { seq: number; code: string; name: string; state: string; attempts: number; assignee: string | null;
  started: string | null; completed: string | null; due: string | null; days: number | null; institution_days: number; on_time: boolean | null }
interface Deficiency { id: number; stage_code: string; reason: string; raised_at: string; raised_by_name: string; response_due_at: string;
  status: string; responded_at: string | null; responded_by_name: string | null; response_text: string | null; files: FileRow[]; days_to_due: number }
interface VisitDetail { id: number; status: string; visit_date: string | null; step_due_at: string | null; days_to_step_due: number | null;
  members: Member[]; common_dates: string[]; files: FileRow[]; assigned_at: string | null; conducted_at: string | null;
  report: { findings: string; recommendation: string; submitted_at: string; submitted_by_name: string } | null;
  reviewed_at: string | null; reviewed_by_name: string | null; review_remarks: string | null }
interface Review { id: number; status: string; summary: string; summary_source: string; summary_at: string; recommendation: string | null;
  recommendation_text: string | null; remarks: string | null; recommended_by_name: string | null; recommended_at: string | null;
  members: { id: number; name: string; designation: string }[] }
interface Official { id: number; name: string; designation: string; rank: number; official_kind: string; load: number }
export interface CaseDetail {
  application: { id: number; ref_no: string; institution: string; city: string; region: string; type_name: string; route_name: string;
    programme: string; academic_year: string; status: string; decision: string | null; decision_reason: string | null;
    decided_at: string | null; decided_by_name: string | null; submitted_at: string; route_snapshot: string[]; institution_id: number };
  route: RouteStep[];
  current: { id: number; stage_code: string; substatus: string; assigned_to: number | null; assignee: string | null; due_at: string;
    started_at: string; paused_at: string | null; seq: number } | null;
  sla: PendencyRow | null; deficiencies: Deficiency[]; visit: VisitDetail | null; review: Review | null;
  undertakings: Undertaking[]; files: FileRow[]; timeline: AuditEntry[];
  alerts: { id: number; kind: string; level: number | null; title: string; fired_at: string }[];
  actions: string[];
  options: { officials?: Official[]; evc_members?: { id: number; name: string; designation: string; load: number }[];
    sac_members?: { id: number; name: string; designation: string }[]; revert_targets?: string[] };
}

type ModalKind = null | "complete" | "deficiency" | "reassign" | "revert" | "decision" | "members" | "schedule" | "review_report"
  | "respond" | "committee" | "availability" | "report" | "recommend";

/* ---------------------------------------------------------------- page */
export default function CaseView({ appId, mode = "case" }: { appId: number; mode?: "case" | "committee" | "visit" }) {
  const user = useApp((s) => s.user)!;
  const { data, error, loading, reload } = useApi<CaseDetail>(`/api/applications/${appId}`);
  const [modal, setModal] = useState<ModalKind>(null);
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "Not found" }} onRetry={reload} />;
  const a = data.application;
  const close = () => setModal(null);
  const has = (x: string) => data.actions.includes(x);

  const primary = primaryAction(data, has, setModal);
  const backHref = user.role === "committee" ? "/my-cases" : "/applications";

  return (
    <div>
      <div className="mb-2 text-[13px]"><Link href={backHref} className="no-underline">← {user.role === "committee" ? "My cases" : "Applications"}</Link></div>
      <PageHeader kicker={`${a.type_name} · ${a.region} Region`} title={`${a.ref_no}`}
        description={`${a.institution}, ${a.city} · ${a.programme} · Academic year ${a.academic_year}`} action={primary} />

      <RouteBar route={data.route} decided={a.status === "decided"} />

      {a.status === "decided" && (
        <div className="sheet settle mb-5 flex flex-wrap items-center gap-3 border-l-4 border-l-olive px-4 py-3">
          <Gavel className="text-olive-ink" size={20} />
          <div className="min-w-0 flex-1 text-[14px]">
            <div className="font-semibold">Decision recorded: {DECISION_TEXT[a.decision ?? ""]}</div>
            <div className="text-ink-soft">{a.decision_reason} · by {a.decided_by_name} on {fmtDate(a.decided_at)}. Recorded by a human authority, not by Argus.</div>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          {mode === "committee" && data.review && <CommitteeCard review={data.review} has={has} open={setModal} reload={reload} />}
          {mode === "visit" && data.visit && <VisitCard visit={data.visit} has={has} open={setModal} />}
          {a.status === "in_progress" && data.current && <CurrentStage data={data} has={has} open={setModal} />}
          {data.deficiencies.length > 0 && <DeficiencyCard defs={data.deficiencies} canRespond={has("respond_deficiency")} open={setModal} />}
          {mode !== "visit" && data.visit && <VisitCard visit={data.visit} has={has} open={setModal} />}
          {mode !== "committee" && data.review && <CommitteeCard review={data.review} has={has} open={setModal} reload={reload} />}
          {data.undertakings.length > 0 && (
            <Card title="Undertakings from this decision" pad={false}>
              <Table>
                <thead><tr><th>Condition</th><th>Due</th><th>State</th></tr></thead>
                <tbody>{data.undertakings.map((u) => (
                  <tr key={u.id}><td>{u.condition_text}</td><td><DueCell date={u.due_date} days={u.state === "closed" ? null : u.days_to_due} fmt={fmtDate} /></td><td><UndertakingState u={u} /></td></tr>
                ))}</tbody>
              </Table>
            </Card>
          )}
          <Card title="Documents" subtitle="Every upload is versioned and fingerprinted (SHA-256)">
            <FileList files={data.files} empty="No application documents yet." />
            {has("upload_document") && (
              <div className="mt-3 border-t border-line/70 pt-3">
                <FilePicker entityType="application" entityId={a.id} slot="supporting" label="Upload a supporting document"
                  onUploaded={() => { useApp.getState().bumpVersion(); }} />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Case facts">
            <KeyVal items={[
              ["Institution", a.institution], ["Region", a.region], ["Type", a.type_name], ["Route", a.route_name],
              ["Submitted", fmtDate(a.submitted_at)],
              ...(data.sla ? [
                ["Age", `${data.sla.age_days} days`] as [string, ReactNode],
                ["With AICTE / committees", `${data.sla.waiting_aicte_days} days`] as [string, ReactNode],
                ["With institution", `${data.sla.waiting_institution_days} days`] as [string, ReactNode],
              ] : []),
            ]} />
          </Card>
          {data.alerts.length > 0 && (
            <Card title="Alerts on this case" subtitle="Sent automatically by the alert engine">
              <ul className="space-y-2 text-[13.5px]">
                {data.alerts.slice(0, 6).map((al) => (
                  <li key={al.id} className="flex gap-2">
                    <span className="mt-0.5">{al.kind === "escalation" ? <Stamp tone="escalated" level={al.level} /> : al.kind === "overdue" ? <Stamp tone="overdue" /> : <Stamp tone="soon">Reminder</Stamp>}</span>
                    <span className="min-w-0"><span className="block leading-snug">{al.title}</span><span className="text-[12px] text-ink-soft">{fmtDate(al.fired_at)}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Case timeline" subtitle="From the tamper-evident audit trail">
            <Timeline entries={data.timeline} />
          </Card>
        </div>
      </div>

      <Modals kind={modal} close={close} data={data} user={user} />
      <NextStep href={user.role === "official" ? "/queue" : user.role === "committee" ? "/my-cases" : "/"} label={user.role === "official" ? "back to my queue" : user.role === "committee" ? "back to my cases" : "back to home"} />
    </div>
  );
}

function primaryAction(d: CaseDetail, has: (x: string) => boolean, open: (m: ModalKind) => void): ReactNode {
  if (has("respond_deficiency")) return <Button kind="primary" onClick={() => open("respond")}><Send size={16} /> Reply to deficiency</Button>;
  if (has("record_decision")) return <Button kind="primary" onClick={() => open("decision")}><Gavel size={16} /> Record decision</Button>;
  if (has("complete_review")) return <Button kind="primary" onClick={() => open("complete")}><CheckCircle2 size={16} /> Complete {d.current?.stage_code === "intake" ? "check" : "scrutiny"}</Button>;
  if (has("review_report")) return <Button kind="primary" onClick={() => open("review_report")}><CheckCircle2 size={16} /> Review visit report</Button>;
  if (has("assign_members") && d.visit?.status === "assignment_pending") return <Button kind="primary" onClick={() => open("members")}><Users size={16} /> Assign EVC members</Button>;
  if (has("schedule_visit") && d.visit?.status === "date_pending") return <Button kind="primary" onClick={() => open("schedule")}><CalendarCheck2 size={16} /> Fix visit date</Button>;
  if (has("respond_availability")) return <Button kind="primary" onClick={() => open("availability")}><CalendarCheck2 size={16} /> Confirm availability</Button>;
  if (has("mark_conducted")) return <MarkConducted visitId={d.visit!.id} />;
  if (has("submit_report")) return <Button kind="primary" onClick={() => open("report")}><FileSignature size={16} /> Submit visit report</Button>;
  if (has("recommend")) return <Button kind="primary" onClick={() => open("recommend")}><PencilLine size={16} /> Record recommendation</Button>;
  return null;
}

function MarkConducted({ visitId }: { visitId: number }) {
  const [busy, setBusy] = useState(false);
  return <Button kind="primary" busy={busy} onClick={async () => { setBusy(true); await act(`/api/visits/${visitId}/conducted`, {}, "Visit marked as conducted. The report is now due."); setBusy(false); }}>
    <Check size={16} /> Mark visit conducted</Button>;
}

/* ---------------------------------------------------------------- route progress */
function RouteBar({ route, decided }: { route: RouteStep[]; decided: boolean }) {
  return (
    <ol className="sheet settle mb-5 flex flex-wrap items-stretch overflow-hidden p-0" aria-label="Route">
      {route.map((s, i) => {
        const done = s.state === "done";
        const active = s.state === "active";
        return (
          <li key={s.seq} className={`relative flex min-w-[150px] flex-1 items-start gap-2.5 px-4 py-3 ${i ? "border-l border-line/70" : ""} ${active ? "bg-brand-tint/50" : ""}`}>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${done ? "bg-olive text-white" : active ? "bg-brand text-white" : "border border-line bg-card text-ink-soft"}`}>
              {done ? <Check size={14} /> : s.seq}
            </span>
            <span className="min-w-0">
              <span className={`block text-[14px] font-semibold leading-tight ${active ? "text-brand-deep" : ""}`}>{s.name}</span>
              <span className="block text-[12px] text-ink-soft">
                {done && `${s.days} day(s)${s.on_time === false ? ", late" : ""}${s.institution_days ? `, ${s.institution_days} with institution` : ""}`}
                {active && `Day ${s.days} · due ${fmtDate(s.due)}`}
                {s.state === "pending" && (decided ? "Not needed" : "Upcoming")}
                {s.state === "reverted" && "Sent back"}
              </span>
              {s.attempts > 1 && <span className="text-[11.5px] text-ochre-ink">Attempt {s.attempts}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- current stage */
function CurrentStage({ data, has, open }: { data: CaseDetail; has: (x: string) => boolean; open: (m: ModalKind) => void }) {
  const cur = data.current!;
  const sla = data.sla;
  const paused = cur.paused_at != null;
  return (
    <Card title={`Now: ${STAGE_NAME[cur.stage_code] ?? cur.stage_code}`} subtitle={sla?.substatus_text}
      action={sla && <SlaStamp status={sla.sla_status} days={sla.days_to_due} level={sla.escalation_level} waitingOn={sla.waiting_on} />}>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">With</div>
          <div className="mt-0.5 text-[15px] font-medium">
            {sla?.waiting_on === "institution" ? data.application.institution
              : sla?.waiting_on === "committee" && data.visit ? "EVC members"
              : sla?.waiting_on === "committee" && data.review ? "SAC/SHC members"
              : cur.assignee ?? "Unassigned"}
          </div>
          <div className="text-[12.5px] text-ink-soft">{WAITING_TEXT[sla?.waiting_on ?? "aicte"]}</div>
        </div>
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Next due</div>
          <div className="mt-0.5 text-[15px] font-medium">{fmtDate(sla?.due_date)}</div>
          <div className={`text-[12.5px] ${sla && sla.days_to_due != null && sla.days_to_due < 0 ? "font-semibold text-brand" : "text-ink-soft"}`}>{dueText(sla?.days_to_due)}</div>
        </div>
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">AICTE time limit</div>
          {paused ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-[15px] font-medium text-ochre-ink"><Hourglass size={15} /> Paused</div>
          ) : (
            <div className="mt-0.5 text-[15px] font-medium">Stage due {fmtDate(cur.due_at)}</div>
          )}
          <div className="text-[12.5px] text-ink-soft">{paused ? "Resumes when the institution replies" : `Started ${fmtDate(cur.started_at)}`}</div>
        </div>
      </div>
      {data.actions.some((x) => ["complete_review", "raise_deficiency", "reassign", "revert", "record_decision", "assign_members", "schedule_visit", "review_report", "assign_committee", "draft_letter"].includes(x)) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-3">
          {has("complete_review") && <Button kind="primary" small onClick={() => open("complete")}><CheckCircle2 size={14} /> Complete and move on</Button>}
          {has("raise_deficiency") && <Button small onClick={() => open("deficiency")}><MessageSquareWarning size={14} /> Return with deficiency</Button>}
          {has("record_decision") && <Button kind="primary" small onClick={() => open("decision")}><Gavel size={14} /> Record decision</Button>}
          {has("assign_members") && <Button small onClick={() => open("members")}><Users size={14} /> {data.visit?.status === "assignment_pending" ? "Assign" : "Change"} EVC members</Button>}
          {has("schedule_visit") && <Button small onClick={() => open("schedule")}><CalendarCheck2 size={14} /> {data.visit?.visit_date ? "Reschedule" : "Fix"} visit date</Button>}
          {has("review_report") && <Button kind="primary" small onClick={() => open("review_report")}><CheckCircle2 size={14} /> Review visit report</Button>}
          {has("assign_committee") && <Button small onClick={() => open("committee")}><Users size={14} /> Change committee members</Button>}
          {has("reassign") && <Button small onClick={() => open("reassign")}><UserRoundCog size={14} /> Reassign</Button>}
          {has("revert") && <Button kind="danger" small onClick={() => open("revert")}><Undo2 size={14} /> Send back</Button>}
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- deficiencies */
function DeficiencyCard({ defs, canRespond, open }: { defs: Deficiency[]; canRespond: boolean; open: (m: ModalKind) => void }) {
  return (
    <Card title="Deficiencies and replies" subtitle="Each return records who raised it, why, and the reply">
      <ol className="space-y-3">
        {defs.map((d, i) => (
          <li key={d.id} className="rounded-md border border-line bg-paper/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] font-semibold">#{i + 1} · {STAGE_NAME[d.stage_code]} · raised by {d.raised_by_name} on {fmtDate(d.raised_at)}</div>
              {d.status === "open" ? (d.days_to_due < 0 ? <Stamp tone="overdue">Reply overdue</Stamp> : <Stamp tone="soon">Reply due {fmtDate(d.response_due_at)}</Stamp>) : <Stamp tone="closed">Answered</Stamp>}
            </div>
            <p className="mt-1.5 text-[14px]"><CornerUpLeft size={14} className="mr-1 inline text-brand" />{d.reason}</p>
            {d.response_text && (
              <div className="mt-2 border-l-2 border-olive pl-3 text-[14px]">
                <div className="text-[12.5px] text-ink-soft">Reply by {d.responded_by_name} on {fmtDate(d.responded_at)}</div>
                {d.response_text}
                {d.files.length > 0 && <div className="mt-1"><FileList files={d.files} /></div>}
              </div>
            )}
            {d.status === "open" && canRespond && <div className="mt-2"><Button kind="primary" small onClick={() => open("respond")}><Send size={14} /> Reply now</Button></div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ---------------------------------------------------------------- EVC */
function VisitCard({ visit, has, open }: { visit: VisitDetail; has: (x: string) => boolean; open: (m: ModalKind) => void }) {
  const STEP: Record<string, string> = {
    assignment_pending: "Waiting for members to be assigned", availability_pending: "Members confirming available dates",
    date_pending: "Visit date to be fixed", scheduled: "Visit scheduled", report_pending: "Visit done, report pending",
    report_submitted: "Report submitted, review pending", reviewed: "Visit complete",
  };
  return (
    <Card title="Expert Visit Committee" subtitle={STEP[visit.status]}
      action={visit.status === "reviewed" ? <Stamp tone="closed">Complete</Stamp> : visit.days_to_step_due != null && visit.days_to_step_due < 0 ? <Stamp tone="overdue">Delayed</Stamp> : <Stamp tone="info">Step due {fmtDate(visit.step_due_at)}</Stamp>}>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Members</div>
          {visit.members.length ? (
            <ul className="space-y-1.5 text-[14px]">
              {visit.members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between gap-2">
                  <span>{m.name}{m.is_convenor && <span className="ml-1 text-[12px] text-ink-soft">(convenor)</span>}</span>
                  {m.availability === "available" ? <Stamp tone="ok">Available</Stamp> : m.availability === "unavailable" ? <Stamp tone="overdue">Unavailable</Stamp> : <Stamp tone="waiting">Pending</Stamp>}
                </li>
              ))}
            </ul>
          ) : <div className="text-[14px] text-ink-soft">Not assigned yet.</div>}
        </div>
        <div>
          <KeyVal items={[
            ["Visit date", visit.visit_date ? fmtDate(visit.visit_date) : "Not fixed"],
            ["Common dates", visit.common_dates.length ? visit.common_dates.slice(0, 4).map((d) => fmtDate(d)).join(", ") : "–"],
            ["Conducted", visit.conducted_at ? fmtDate(visit.conducted_at) : "–"],
          ]} />
        </div>
      </div>
      {visit.report && (
        <div className="mt-3 rounded-md border border-line bg-paper/50 p-3 text-[14px]">
          <div className="mb-1 flex items-center justify-between"><b>Visit report</b><Stamp tone={visit.report.recommendation === "satisfactory" ? "ok" : "soon"}>{REPORT_OUTCOME_TEXT[visit.report.recommendation]}</Stamp></div>
          <p>{visit.report.findings}</p>
          <div className="mt-1 text-[12.5px] text-ink-soft">Submitted by {visit.report.submitted_by_name} on {fmtDate(visit.report.submitted_at)}{visit.reviewed_at && ` · reviewed by ${visit.reviewed_by_name} on ${fmtDate(visit.reviewed_at)}`}</div>
          {visit.files.length > 0 && <div className="mt-2"><FileList files={visit.files} /></div>}
        </div>
      )}
      {(has("respond_availability") || has("submit_report") || has("mark_conducted")) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line/70 pt-3">
          {has("respond_availability") && <Button kind="primary" small onClick={() => open("availability")}><CalendarCheck2 size={14} /> Confirm availability</Button>}
          {has("mark_conducted") && <MarkConducted visitId={visit.id} />}
          {has("submit_report") && <Button kind="primary" small onClick={() => open("report")}><FileSignature size={14} /> Submit visit report</Button>}
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- committee */
function CommitteeCard({ review, has, open, reload }: { review: Review; has: (x: string) => boolean; open: (m: ModalKind) => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const regen = async () => {
    setBusy(true);
    const r = await act<{ source: string }>(`/api/reviews/${review.id}/summary`, { use_llm: true });
    if (r) useApp.getState().toast("info", r.source === "llm" ? "Summary redrafted with the AI helper. Please review it." : "AI helper not available; summary rebuilt from the offline template.");
    setBusy(false);
    reload();
  };
  return (
    <Card title="SAC/SHC review" subtitle={`Members: ${review.members.map((m) => m.name).join(", ")}`}
      action={review.status === "recommended" ? <Stamp tone="closed">Recommended</Stamp> : <Stamp tone="soon">Awaiting recommendation</Stamp>}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">Electronic case summary</span>
        <DraftLabel />
        <span className="text-[12px] text-ink-soft">{review.summary_source === "llm" ? "Drafted with the AI helper" : "Built from case records (offline template)"} · {fmtDateTime(review.summary_at)}</span>
        {has("regenerate_summary") && <Button small kind="ghost" busy={busy} onClick={regen}><RefreshCw size={13} /> Redraft</Button>}
      </div>
      <pre className="whitespace-pre-wrap rounded-md border border-line bg-[#fffdf8] p-3 font-sans text-[13.5px] leading-relaxed">{review.summary}</pre>
      {review.recommendation && (
        <div className="mt-3 rounded-md border-l-4 border-olive bg-olive-tint/50 px-3 py-2 text-[14px]">
          <b>{review.recommendation_text}</b> · {review.remarks}
          <div className="text-[12.5px] text-ink-soft">Recorded by {review.recommended_by_name} on {fmtDate(review.recommended_at)}. This is advice to the competent authority, not a decision.</div>
        </div>
      )}
      {has("recommend") && <div className="mt-3"><Button kind="primary" small onClick={() => open("recommend")}><PencilLine size={14} /> Record recommendation</Button></div>}
    </Card>
  );
}

/* ---------------------------------------------------------------- modals */
function Modals({ kind, close, data, user }: { kind: ModalKind; close: () => void; data: CaseDetail; user: SessionUser }) {
  if (!kind) return null;
  const a = data.application;
  const props = { close, data, user };
  switch (kind) {
    case "complete": return <SimpleRemarks {...props} title={`Complete ${STAGE_NAME[data.current!.stage_code]}`} path={`/api/applications/${a.id}/complete`}
      help="The case moves automatically to the next stage of its route." success="Done. The case moved to its next stage." />;
    case "review_report": return <SimpleRemarks {...props} title="Review visit report" path={`/api/visits/${data.visit!.id}/review`}
      help="Marks the EVC stage complete and routes the case onwards." success="Report reviewed. The case moved on." />;
    case "deficiency": return <DeficiencyModal {...props} />;
    case "respond": return <RespondModal {...props} />;
    case "reassign": return <ReassignModal {...props} />;
    case "revert": return <RevertModal {...props} />;
    case "decision": return <DecisionModal {...props} />;
    case "members": return <MembersModal {...props} />;
    case "schedule": return <ScheduleModal {...props} />;
    case "committee": return <CommitteeMembersModal {...props} />;
    case "availability": return <AvailabilityModal {...props} />;
    case "report": return <ReportModal {...props} />;
    case "recommend": return <RecommendModal {...props} />;
  }
}

type MP = { close: () => void; data: CaseDetail; user: SessionUser };

function useSubmit(close: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    const r = await act(path, body, ok);
    setBusy(false);
    if (r) close();
  };
  return { busy, run };
}

function SimpleRemarks({ close, title, path, help, success }: MP & { title: string; path: string; help: string; success: string }) {
  const [remarks, setRemarks] = useState("");
  const { busy, run } = useSubmit(close);
  return (
    <Modal title={title} onClose={close} footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} onClick={() => run(path, { remarks }, success)}>Confirm</Button></>}>
      <p className="text-[14px] text-ink-soft">{help}</p>
      <Field label="Remarks (optional)"><textarea className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
    </Modal>
  );
}

function DeficiencyModal({ close, data }: MP) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(15);
  const [draft, setDraft] = useState<{ text: string; source: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const { busy, run } = useSubmit(close);
  const makeDraft = async () => {
    setDrafting(true);
    try { setDraft(await api(`/api/applications/${data.application.id}/draft-letter`, { body: { kind: "deficiency", reason, use_llm: true } })); }
    catch (e) { useApp.getState().toast("error", (e as Error).message); }
    setDrafting(false);
  };
  return (
    <Modal wide title="Return with a deficiency" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={reason.trim().length < 10}
        onClick={() => run(`/api/applications/${data.application.id}/deficiency`, { reason, response_days: days }, "Returned to the institution. The AICTE time limit is paused.")}>Return to institution</Button></>}>
      <Field label="Reason (required)" hint="Say exactly what is missing or wrong, so the institution can fix it in one go. At least 10 characters.">
        <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Faculty list is short of the required cadre ratio. Upload revised faculty details." />
      </Field>
      <Field label="Days the institution has to reply" hint="Default comes from the Rules page (illustrative).">
        <input type="number" min={1} max={60} className="input max-w-[120px]" value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </Field>
      <div className="rounded-md border border-line bg-paper/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold">Deficiency letter</span>
          <Button small kind="ghost" busy={drafting} onClick={makeDraft}><Sparkles size={13} /> Draft letter</Button>
        </div>
        {draft ? (
          <>
            <div className="mb-1 flex items-center gap-2"><DraftLabel /><span className="text-[12px] text-ink-soft">{draft.source === "llm" ? "AI helper" : "Offline template"}</span></div>
            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-[13px]">{draft.text}</pre>
          </>
        ) : <p className="text-[13px] text-ink-soft">Optional: draft a letter from the case facts. You review it; nothing is sent automatically.</p>}
      </div>
    </Modal>
  );
}

function RespondModal({ close, data }: MP) {
  const d = data.deficiencies.find((x) => x.status === "open")!;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<number[]>([]);
  const { busy, run } = useSubmit(close);
  return (
    <Modal wide title="Reply to the deficiency" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={text.trim().length < 10}
        onClick={() => run(`/api/applications/${data.application.id}/respond`, { deficiency_id: d.id, response: text, file_ids: files }, "Reply sent. The case is back with the officer for re-scrutiny.")}>Send reply</Button></>}>
      <div className="rounded-md border-l-4 border-brand bg-brand-tint/40 px-3 py-2 text-[14px]">{d.reason}<div className="text-[12.5px] text-ink-soft">Reply due {fmtDate(d.response_due_at)} ({dueText(d.days_to_due)})</div></div>
      <Field label="Your reply"><textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Explain what you have corrected and what you are uploading." /></Field>
      <FilePicker entityType="deficiency" entityId={d.id} slot="reply" label="Attach supporting document" onUploaded={(f) => setFiles((x) => [...x, f.id])} />
    </Modal>
  );
}

function ReassignModal({ close, data }: MP) {
  const opts = data.options.officials ?? [];
  const decision = data.current?.stage_code === "decision";
  const list = opts.filter((o) => !decision || o.rank >= 2);
  const [uid, setUid] = useState<number | null>(null);
  const { busy, run } = useSubmit(close);
  return (
    <Modal title="Reassign this case" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={!uid} onClick={() => run(`/api/applications/${data.application.id}/assign`, { user_id: uid }, "Case reassigned.")}><ArrowRightLeft size={14} /> Reassign</Button></>}>
      <p className="text-[14px] text-ink-soft">Currently with <b className="text-ink">{data.current?.assignee ?? "nobody"}</b>. Load = active stages assigned.</p>
      <div className="space-y-1.5">
        {list.map((o) => (
          <label key={o.id} className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-[14px] ${uid === o.id ? "border-brand bg-brand-tint/50" : "border-line"}`}>
            <span className="flex items-center gap-2"><input type="radio" name="o" checked={uid === o.id} onChange={() => setUid(o.id)} disabled={o.id === data.current?.assigned_to} />
              <span><b>{o.name}</b><span className="block text-[12px] text-ink-soft">{o.designation}</span></span></span>
            <span className="text-[12.5px] text-ink-soft">load {o.load}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function RevertModal({ close, data }: MP) {
  const targets = data.options.revert_targets ?? [];
  const [to, setTo] = useState(targets[targets.length - 1] ?? "");
  const [reason, setReason] = useState("");
  const { busy, run } = useSubmit(close);
  return (
    <Modal title="Send the case back" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="danger" busy={busy} disabled={reason.trim().length < 10 || !to} onClick={() => run(`/api/applications/${data.application.id}/revert`, { to_stage: to, reason }, "Case sent back.")}>Send back</Button></>}>
      <Field label="Back to"><select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{targets.map((t) => <option key={t} value={t}>{STAGE_NAME[t]}</option>)}</select></Field>
      <Field label="Reason (required)"><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

function DecisionModal({ close, data, user }: MP) {
  const [outcome, setOutcome] = useState("approved_with_undertakings");
  const [reason, setReason] = useState("");
  const today = useApp.getState().clock?.today ?? new Date().toISOString().slice(0, 10);
  const [unds, setUnds] = useState([{ condition: "", due_date: addDays(today, 90) }]);
  const { busy, run } = useSubmit(close);
  const rec = data.review?.recommendation_text;
  const valid = reason.trim().length >= 10 && (outcome !== "approved_with_undertakings" || (unds.length > 0 && unds.every((u) => u.condition.trim().length >= 10 && u.due_date > today)));
  return (
    <Modal wide title="Record the competent authority's decision" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={!valid}
        onClick={() => run(`/api/applications/${data.application.id}/decision`, { outcome, reason, undertakings: outcome === "approved_with_undertakings" ? unds : [] }, "Decision recorded and audited.")}>
        <Gavel size={14} /> Record decision as {user.name}</Button></>}>
      <div className="rounded-md bg-paper-2/60 px-3 py-2 text-[13px]">Argus does not decide. You are recording the decision of the competent authority; it is logged with your name, the time and the reason.{rec && <> Committee recommendation on file: <b>{rec}</b>.</>}</div>
      <Field label="Outcome">
        <div className="grid gap-1.5 sm:grid-cols-3">
          {Object.entries(DECISION_TEXT).map(([k, v]) => (
            <label key={k} className={`cursor-pointer rounded-md border px-3 py-2 text-[14px] ${outcome === k ? "border-brand bg-brand-tint/50 font-semibold" : "border-line"}`}>
              <input type="radio" className="mr-2" checked={outcome === k} onChange={() => setOutcome(k)} />{v}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Reason (required)"><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {outcome === "approved_with_undertakings" && (
        <div>
          <div className="mb-1 text-[13px] font-semibold">Undertakings (time-bound conditions)</div>
          <div className="space-y-2">
            {unds.map((u, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                <input className="input" placeholder="Condition the institution must meet" value={u.condition} onChange={(e) => setUnds(unds.map((x, j) => j === i ? { ...x, condition: e.target.value } : x))} />
                <input type="date" className="input" value={u.due_date} min={addDays(today, 1)} onChange={(e) => setUnds(unds.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x))} />
                <Button small onClick={() => setUnds(unds.filter((_, j) => j !== i))} disabled={unds.length === 1}>Remove</Button>
              </div>
            ))}
          </div>
          <button className="mt-2 text-[13px] font-medium text-brand" onClick={() => setUnds([...unds, { condition: "", due_date: addDays(today, 90) }])}>+ Add another undertaking</button>
        </div>
      )}
    </Modal>
  );
}

function MembersModal({ close, data }: MP) {
  const pool = data.options.evc_members ?? [];
  const current = data.visit?.members.map((m) => m.user_id) ?? [];
  const [sel, setSel] = useState<number[]>(current);
  const [conv, setConv] = useState<number | null>(data.visit?.members.find((m) => m.is_convenor)?.user_id ?? null);
  const { busy, run } = useSubmit(close);
  const toggle = (id: number) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <Modal wide title="Assign EVC members" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={sel.length < 2 || !conv || !sel.includes(conv)}
        onClick={() => run(`/api/visits/${data.visit!.id}/members`, { member_ids: sel, convenor_id: conv }, "Members assigned and asked to confirm availability.")}>Assign {sel.length} members</Button></>}>
      <p className="text-[14px] text-ink-soft">Pick 2 to 5 members and a convenor. Load = open visits each member already has.</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {pool.map((m) => (
          <div key={m.id} className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-[14px] ${sel.includes(m.id) ? "border-brand bg-brand-tint/40" : "border-line"}`}>
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={sel.includes(m.id)} onChange={() => toggle(m.id)} />
              <span><b>{m.name}</b><span className="block text-[12px] text-ink-soft">load {m.load}</span></span></label>
            <label className="flex items-center gap-1 text-[12px]"><input type="radio" name="conv" checked={conv === m.id} onChange={() => { setConv(m.id); if (!sel.includes(m.id)) setSel([...sel, m.id]); }} />Convenor</label>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ScheduleModal({ close, data }: MP) {
  const common = data.visit?.common_dates ?? [];
  const today = useApp.getState().clock?.today ?? "";
  const [date, setDate] = useState(common.find((d) => d > today) ?? addDays(today, 7));
  const { busy, run } = useSubmit(close);
  return (
    <Modal title="Fix the visit date" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} onClick={() => run(`/api/visits/${data.visit!.id}/schedule`, { visit_date: date }, "Visit date fixed. Members and the institution are notified.")}>Fix date</Button></>}>
      {common.length > 0 ? (
        <Field label="Dates all available members offered">
          <div className="flex flex-wrap gap-1.5">{common.filter((d) => d > today).map((d) => (
            <button key={d} onClick={() => setDate(d)} className={`rounded-md border px-2.5 py-1 text-[13px] ${date === d ? "border-brand bg-brand text-white" : "border-line"}`}>{fmtDate(d)}</button>
          ))}</div>
        </Field>
      ) : <p className="text-[14px] text-ink-soft">No common date yet; you can still pick one.</p>}
      <Field label="Visit date"><input type="date" className="input max-w-[200px]" min={addDays(today, 1)} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    </Modal>
  );
}

function CommitteeMembersModal({ close, data }: MP) {
  const pool = data.options.sac_members ?? [];
  const [sel, setSel] = useState<number[]>(data.review?.members.map((m) => m.id) ?? []);
  const { busy, run } = useSubmit(close);
  return (
    <Modal title="SAC/SHC members for this case" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={!sel.length} onClick={() => run(`/api/reviews/${data.review!.id}/members`, { member_ids: sel }, "Committee members updated.")}>Save</Button></>}>
      {pool.map((m) => (
        <label key={m.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={sel.includes(m.id)} onChange={() => setSel(sel.includes(m.id) ? sel.filter((x) => x !== m.id) : [...sel, m.id])} />{m.name}</label>
      ))}
    </Modal>
  );
}

function AvailabilityModal({ close, data }: MP) {
  const today = useApp.getState().clock?.today ?? "";
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i + 3));
  const [sel, setSel] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const { busy, run } = useSubmit(close);
  return (
    <Modal wide title="Confirm your availability" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={!unavailable && !sel.length}
        onClick={() => run(`/api/visits/${data.visit!.id}/availability`, { available: !unavailable, dates: unavailable ? [] : sel }, "Thank you. Your availability is recorded.")}>Submit</Button></>}>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} /> I cannot take part in this visit</label>
      {!unavailable && (
        <Field label="Pick the dates you can visit (up to 10)">
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {days.map((d) => (
              <button key={d} onClick={() => setSel(sel.includes(d) ? sel.filter((x) => x !== d) : sel.length < 10 ? [...sel, d] : sel)}
                className={`rounded-md border px-1 py-1.5 text-[12.5px] ${sel.includes(d) ? "border-brand bg-brand text-white" : "border-line bg-card hover:border-brand"}`}>{fmtDate(d).slice(0, 6)}</button>
            ))}
          </div>
        </Field>
      )}
    </Modal>
  );
}

function ReportModal({ close, data }: MP) {
  const [findings, setFindings] = useState("");
  const [rec, setRec] = useState("satisfactory");
  const [fileId, setFileId] = useState<number | null>(null);
  const { busy, run } = useSubmit(close);
  return (
    <Modal wide title="Submit the visit report" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={findings.trim().length < 20}
        onClick={() => run(`/api/visits/${data.visit!.id}/report`, { findings, recommendation: rec, file_id: fileId }, "Report submitted for the officer's review.")}>Submit report</Button></>}>
      <Field label="Findings" hint="At least 20 characters. Record what the committee observed."><textarea className="input" value={findings} onChange={(e) => setFindings(e.target.value)} /></Field>
      <Field label="Overall finding">
        <select className="input" value={rec} onChange={(e) => setRec(e.target.value)}>{Object.entries(REPORT_OUTCOME_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Field>
      <FilePicker entityType="evc_visit" entityId={data.visit!.id} slot="visit_report" label="Attach signed report" onUploaded={(f) => setFileId(f.id)} />
    </Modal>
  );
}

function RecommendModal({ close, data }: MP) {
  const [rec, setRec] = useState("recommend_approval");
  const [remarks, setRemarks] = useState("");
  const { busy, run } = useSubmit(close);
  return (
    <Modal wide title="Record the committee's recommendation" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={remarks.trim().length < 10}
        onClick={() => run(`/api/reviews/${data.review!.id}/recommend`, { recommendation: rec, remarks }, "Recommendation recorded. The case moves to the competent authority.")}>Record recommendation</Button></>}>
      <p className="rounded-md bg-paper-2/60 px-3 py-2 text-[13px]">A recommendation is advice to the competent authority. The decision is recorded separately by the authority.</p>
      <div className="space-y-1.5">
        {Object.entries(RECOMMENDATION_TEXT).map(([k, v]) => (
          <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[14px] ${rec === k ? "border-brand bg-brand-tint/50" : "border-line"}`}>
            <input type="radio" checked={rec === k} onChange={() => setRec(k)} />{v}
          </label>
        ))}
      </div>
      <Field label="Remarks (required)"><textarea className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
    </Modal>
  );
}
