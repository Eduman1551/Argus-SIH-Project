"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { VisitStamp } from "@/components/status";
import { Avatar, Empty, ErrorNote, HelpBox, Metrics, NextStep, PageHeader, PageSkeleton, Stat, Tabs } from "@/components/ui";
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
  const delayed = by("delayed").length;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Monitoring" }, { label: "EVC board" }]} title="EVC scheduling board"
        description="Every Expert Visit Committee visit, from assignment to report review. Delayed visits sit in the last column."
        action={user.official_kind === "regional" ? (
          <Tabs className="" value={all ? "all" : "mine"} onChange={(v) => setAll(v === "all")}
            tabs={[{ id: "mine", label: `My Region` }, { id: "all", label: "All Regions" }]} />) : undefined} />
      <HelpBox id="evc">
        Each card is one visit. Open it to assign members, fix the date or review the report. A visit moves to <b>Delayed</b> when any step
        passes its configured limit; reminders and escalations for it are sent automatically.
      </HelpBox>
      <Metrics>
        <Stat label="Open visits" value={data.visits.length - completed} hint={all ? "All Regions" : user.region_name ?? ""} />
        <Stat label="Due now" value={by("due").length} tone={by("due").length ? "warn" : "ink"} hint={`Visit within ${data.window_days} days`} />
        <Stat label="Delayed" value={delayed} tone={delayed ? "red" : "good"} hint="A step past its limit" />
        <Stat label="Completed" value={completed} tone="good" hint="Report reviewed" />
      </Metrics>
      {data.visits.length === 0 ? <Empty title="No expert visits yet.">Visits appear here when a case reaches its EVC stage.</Empty> : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {COLUMNS.map((col) => {
            const items = by(col.id);
            const bad = col.id === "delayed" && items.length > 0;
            return (
              <section key={col.id} aria-label={`${col.title}: ${items.length}`}
                className={`flex min-h-[240px] flex-col rounded-2xl border ${bad ? "border-danger/30 bg-danger-tint/50" : "border-line bg-surface-2"}`}>
                <div className="px-3 pb-2 pt-3">
                  <div className="flex items-center justify-between">
                    <h2 className={`text-[14px] font-semibold ${bad ? "text-danger-ink" : ""}`}>{col.title}</h2>
                    <span className={`mono rounded-full px-2 text-[12px] font-semibold ${bad ? "bg-danger text-white" : "bg-surface text-ink ring-1 ring-inset ring-line"}`}>{items.length}</span>
                  </div>
                  <div className="text-[12px] text-ink-soft">{col.hint}</div>
                </div>
                <div className="flex-1 space-y-2 px-2 pb-2">
                  {items.map((v) => (
                    <Link key={v.id} href={`/applications/${v.application_id}`}
                      className="surface block p-2.5 text-ink no-underline transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md">
                      <div className="mono text-[12.5px] font-medium text-brand">{v.ref_no}</div>
                      <div className="truncate text-[12px] text-ink-soft">{v.institution}</div>
                      <div className="mt-1.5 text-[12.5px] font-medium leading-snug">{v.step}</div>
                      {v.visit_date && <div className="mono mt-0.5 flex items-center gap-1 text-[11.5px]"><CalendarDays size={12} className="text-brand" /> {fmtDate(v.visit_date)}</div>}
                      {v.step_due_at && <div className={`text-[11.5px] ${v.days_to_due != null && v.days_to_due < 0 ? "font-medium text-danger-ink" : "text-ink-soft"}`}>Step {dueText(v.days_to_due)}</div>}
                      {v.members.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1" aria-label={`Members: ${v.members.map((m) => m.name).join(", ")}`}>
                          {v.members.slice(0, 5).map((m) => <Avatar key={m.user_id} name={m.name} size={22} />)}
                        </div>
                      )}
                      {(v.escalation_level || v.category === "delayed" || v.category === "due") && <div className="mt-1.5"><VisitStamp v={v} /></div>}
                    </Link>
                  ))}
                  {!items.length && <div className="rounded-xl border border-dashed border-line px-2 py-5 text-center text-[12px] text-ink-soft">None</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <NextStep href="/compliance" label="undertakings and verification" />
    </div>
  );
}
