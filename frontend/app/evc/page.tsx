"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, Users } from "lucide-react";
import { VisitStamp } from "@/components/home/CommitteeCases";
import { ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Stat } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dueText, fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Visit } from "@/lib/types";

const COLUMNS: { id: string; title: string; hint: string }[] = [
  { id: "queue", title: "Queue", hint: "Members to be assigned" },
  { id: "coordinating", title: "Coordinating", hint: "Availability and date" },
  { id: "scheduled", title: "Scheduled", hint: "Visit date fixed" },
  { id: "due", title: "Due now", hint: "Visit within the due window" },
  { id: "report", title: "Report stage", hint: "Report pending or in review" },
  { id: "delayed", title: "Delayed", hint: "A step is past its limit" },
];

export default function EvcBoard() {
  const user = useApp((s) => s.user)!;
  const [all, setAll] = useState(user.official_kind !== "regional");
  const { data, error, loading, reload } = useApi<{ visits: Visit[]; window_days: number }>(
    user.role === "official" ? `/api/evc/board${all ? "?all_regions=true" : ""}` : null);
  if (user.role !== "official") return <ErrorNote error={{ message: "The EVC board is for officials." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const by = (c: string) => data.visits.filter((v) => v.category === c);
  const completed = by("completed").length;

  return (
    <div>
      <PageHeader title="EVC scheduling board" description="Every Expert Visit Committee visit, from assignment to report review. Delayed visits sit in the red column."
        action={user.official_kind === "regional" ? (
          <div className="inline-flex rounded-md border border-line bg-card p-0.5 text-[13px]">
            <button onClick={() => setAll(false)} className={`rounded px-3 py-1.5 ${!all ? "bg-brand text-white" : ""}`}>My Region</button>
            <button onClick={() => setAll(true)} className={`rounded px-3 py-1.5 ${all ? "bg-brand text-white" : ""}`}>All Regions</button>
          </div>) : undefined} />
      <HelpBox id="evc">
        Each card is one visit. Open it to assign members, fix the date or review the report. A visit goes to <b>Delayed</b> when any step
        passes its configured limit; reminders and escalations for it are sent automatically.
      </HelpBox>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open visits" value={data.visits.length - completed} />
        <Stat label="Due now" value={by("due").length} tone="ochre" hint={`Visit within ${data.window_days} days`} />
        <Stat label="Delayed" value={by("delayed").length} tone={by("delayed").length ? "red" : "olive"} />
        <Stat label="Completed" value={completed} tone="olive" />
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const items = by(col.id);
          return (
            <section key={col.id} className={`flex min-h-[220px] flex-col rounded-lg border ${col.id === "delayed" ? "border-brand/50 bg-brand-tint/40" : "border-line bg-paper-2/50"}`}>
              <div className="border-b border-line/70 px-3 py-2">
                <div className="flex items-center justify-between">
                  <h2 className={`text-[15px] font-semibold ${col.id === "delayed" ? "text-brand-deep" : ""}`}>{col.title}</h2>
                  <span className="rounded-full bg-card px-2 text-[12px] font-bold tabular-nums">{items.length}</span>
                </div>
                <div className="text-[12px] text-ink-soft">{col.hint}</div>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {items.map((v) => (
                  <Link key={v.id} href={`/applications/${v.application_id}`} className="sheet block p-2.5 text-ink no-underline hover:border-brand/60">
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-[13.5px] font-semibold text-brand">{v.ref_no}</span>
                    </div>
                    <div className="truncate text-[12.5px] text-ink-soft">{v.institution}</div>
                    <div className="mt-1.5 text-[13px] font-medium">{v.step}</div>
                    {v.visit_date && <div className="flex items-center gap-1 text-[12.5px]"><CalendarDays size={12} /> {fmtDate(v.visit_date)}</div>}
                    {v.step_due_at && <div className={`text-[12px] ${v.days_to_due != null && v.days_to_due < 0 ? "font-semibold text-brand" : "text-ink-soft"}`}>Step {dueText(v.days_to_due)}</div>}
                    {v.members.length > 0 && <div className="mt-1 flex items-center gap-1 truncate text-[12px] text-ink-soft"><Users size={12} /> {v.members.map((m) => m.name.split(" ").slice(-1)[0]).join(", ")}</div>}
                    {(v.escalation_level || v.category === "delayed" || v.category === "due") && <div className="mt-1.5"><VisitStamp v={v} /></div>}
                  </Link>
                ))}
                {!items.length && <div className="px-1 py-4 text-center text-[12.5px] text-ink-soft">None</div>}
              </div>
            </section>
          );
        })}
      </div>
      <NextStep href="/compliance" label="undertakings and verification" />
    </div>
  );
}
