"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { GripVertical, Minus, Pencil, Plus, Save, X } from "lucide-react";
import {
  Avatar, Button, Callout, Card, Collapsible, DocLayout, Empty, ErrorNote, Field, HelpBox, Modal, PageHeader, PageSkeleton, Section, Stamp, Table,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { addDays, fmtDate, fmtDateTime } from "@/lib/format";
import { STAGE_NAME } from "@/lib/labels";
import { toast, useApp } from "@/lib/store";

interface Rules {
  illustrative_notice: string; can_edit: boolean;
  sla: { code: string; label: string; days: number; waits_on: string; description: string }[];
  stages: { code: string; name: string; sla_code: string }[];
  routes: { code: string; name: string; description: string; stages: string[] }[];
  application_types: { code: string; name: string; route_code: string }[];
  reminders: { id: number; entity_type: string; kind: string; offset_days: number; active: boolean; effective_from: string }[];
  escalation_levels: { level: number; title: string; target: string }[];
  escalation_rules: { entity_type: string; level: number; days_after_due: number }[];
  templates: { code: string; label: string; subject: string; body: string; sms: string }[];
  settings: { key: string; value: number; label: string; description: string }[];
  entity_types: { code: string; label: string }[];
  escalation_targets: { code: string; label: string }[];
  risk_factors: { code: string; label: string; weight: number; description: string }[];
  intervention_rules: { id: number; code: string; label: string; trigger_text: string; action: string; action_text: string;
    authorized_by: string; threshold: number; threshold_label: string; est_days_saved: number; active: boolean; version: number }[];
}
interface Change { id: number; at: string; actor_label: string; entity_id: string; details: { rule?: string; key?: string; before?: unknown; after?: unknown } }

async function save(path: string, body: unknown, ok: string) {
  try {
    await api(path, { method: "PUT", body });
    toast.success(ok);
    useApp.getState().bumpVersion();
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

const short = (d: string) => fmtDate(d).slice(0, 6);

/* ---------------------------------------------------------------- small controls */
function Stepper({ value, onChange, min = 0, max = 365, disabled, label, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; disabled?: boolean; label: string; suffix?: string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Number.isNaN(v) ? min : v)));
  return (
    <span className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface" role="group" aria-label={label}>
      <button type="button" disabled={disabled || value <= min} onClick={() => set(value - 1)} aria-label={`Decrease ${label}`}
        className="flex h-full w-7 items-center justify-center rounded-l-lg text-ink-soft hover:bg-surface-2 hover:text-ink disabled:opacity-40"><Minus size={13} /></button>
      <input type="number" value={value} min={min} max={max} disabled={disabled} aria-label={label} onChange={(e) => set(Number(e.target.value))}
        className="mono h-full w-11 border-x border-line bg-transparent text-center text-[13px] outline-none [appearance:textfield] focus-visible:bg-brand-tint [&::-webkit-inner-spin-button]:appearance-none" />
      <button type="button" disabled={disabled || value >= max} onClick={() => set(value + 1)} aria-label={`Increase ${label}`}
        className="flex h-full w-7 items-center justify-center rounded-r-lg text-ink-soft hover:bg-surface-2 hover:text-ink disabled:opacity-40"><Plus size={13} /></button>
      {suffix && <span className="px-2 text-[12px] text-ink-soft">{suffix}</span>}
    </span>
  );
}

function SaveBar({ dirty, onSave, onReset }: { dirty: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return (
    <span className="enter inline-flex items-center gap-1.5">
      <Button small kind="primary" onClick={onSave}><Save size={13} /> Save</Button>
      <Button small kind="ghost" onClick={onReset}>Undo</Button>
    </span>
  );
}

function Preview({ children }: { children: ReactNode }) {
  return <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-ink-soft ring-1 ring-inset ring-line">{children}</div>;
}

/* ---------------------------------------------------------------- page */
const TOC = [
  { id: "about", label: "About these values" },
  { id: "routes", label: "Routes" },
  { id: "types", label: "Application types" },
  { id: "limits", label: "Time limits" },
  { id: "reminders", label: "Reminders" },
  { id: "escalation", label: "Escalation chain" },
  { id: "risk", label: "Delay risk" },
  { id: "actions", label: "Recommended actions" },
  { id: "templates", label: "Message templates" },
  { id: "settings", label: "Other settings" },
  { id: "history", label: "Change history" },
];

export default function RulesPage() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const { data, error, loading, reload } = useApi<Rules>(user.role === "official" ? "/api/rules" : null);
  const history = useApi<{ rows: Change[] }>(user.role === "official" ? "/api/audit?action=rule.changed&limit=25" : null);
  const [editTpl, setEditTpl] = useState<Rules["templates"][number] | null>(null);
  if (user.role !== "official") return <ErrorNote error={{ message: "Rules are maintained by Bureau officers." }} />;
  if (loading || !today) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const ro = !data.can_edit;
  const slaOf = (stage: string) => data.sla.find((s) => s.code === data.stages.find((x) => x.code === stage)?.sla_code)?.days ?? 0;
  const sampleDue = (entity: string) => addDays(today, entity === "stage" ? slaOf("scrutiny") : 30);
  const sampleWhat = (entity: string) => entity === "stage" ? `A case entering Scrutiny today (time limit ${slaOf("scrutiny")} days)` : `An item of this type due in 30 days`;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Rules" }]} title="Rules"
        description="Time limits, reminders and who is alerted. Changes apply at once and are recorded." />
      <HelpBox id="rules">Change a value and press Save. The grey line under each rule shows the dates it would give.</HelpBox>

      <DocLayout toc={TOC}>
        <div className="space-y-9">
          <section id="about" className="scroll-mt-28">
            <Callout kind="warning" title="Illustrative values, not official APH figures">
              {data.illustrative_notice} {ro && "You can view these rules; only Bureau officers can change them."}
            </Callout>
          </section>

          <Section id="routes" title="Routes" description="The ordered stages a case passes through. Drag the stage chips to reorder, or focus one and use the arrow keys.">
            <div className="grid gap-3 lg:grid-cols-2">
              {data.routes.map((r) => <RouteCard key={r.code + r.stages.join()} route={r} stages={data.stages} ro={ro} today={today} slaOf={slaOf} />)}
            </div>
          </Section>

          <Section id="types" title="Application types" description="Which route each type of application follows.">
            <Card pad={false}>
              <Table>
                <thead><tr><th>Type</th><th>Route</th><th>Stages</th></tr></thead>
                <tbody>{data.application_types.map((t) => {
                  const route = data.routes.find((r) => r.code === t.route_code);
                  return (
                    <tr key={t.code}><td>{t.name}</td>
                      <td><select className="field h-8 w-auto py-0 text-[13px]" value={t.route_code} disabled={ro} aria-label={`Route for ${t.name}`}
                        onChange={(e) => save(`/api/rules/application-types/${t.code}`, { route_code: e.target.value }, `${t.name} now follows ${data.routes.find((r) => r.code === e.target.value)?.name}.`)}>
                        {data.routes.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                      </select></td>
                      <td className="text-[12.5px] text-ink-soft">{route?.stages.map((s) => STAGE_NAME[s]).join(" → ")}</td></tr>
                  );
                })}</tbody>
              </Table>
            </Card>
          </Section>

          <Section id="limits" title="Time limits" description="Days allowed for each step. Every due date is computed from these.">
            <Card pad={false}>
              <ul className="divide-y divide-line">{data.sla.map((s) => <SlaRow key={`${s.code}${s.days}`} s={s} ro={ro} today={today} />)}</ul>
            </Card>
          </Section>

          <Section id="reminders" title="Reminders" description="Days before the due date when a reminder goes out, and the day after it when the overdue alert fires.">
            <Card pad={false}>
              <ul className="divide-y divide-line">
                {data.entity_types.map((e) => {
                  const active = data.reminders.filter((r) => r.entity_type === e.code && r.active);
                  return <ReminderRow key={e.code + active.map((r) => `${r.kind}${r.offset_days}`).join()} e={e} active={active} ro={ro}
                    due={sampleDue(e.code)} what={sampleWhat(e.code)} />;
                })}
              </ul>
            </Card>
          </Section>

          <Section id="escalation" title="Escalation chain" description="Who is alerted at each level, and how many days after the due date each level is reached.">
            <div className="grid items-start gap-4 2xl:grid-cols-2">
              <Card title="Levels" pad={false}>
                <ul className="divide-y divide-line">{data.escalation_levels.map((l) => <LevelRow key={`${l.level}${l.title}${l.target}`} l={l} targets={data.escalation_targets} ro={ro} />)}</ul>
              </Card>
              <Card title="Days after due" pad={false}>
                <ul className="divide-y divide-line">{data.entity_types.map((e) => {
                  const days = data.escalation_rules.filter((r) => r.entity_type === e.code).sort((a, b) => a.level - b.level).map((r) => r.days_after_due);
                  return <EscDaysRow key={e.code + days.join()} e={e} days={days} ro={ro} due={sampleDue(e.code)} />;
                })}</ul>
              </Card>
            </div>
          </Section>

          <Section id="risk" title="Delay risk"
            description="How much each factor counts in the delay-risk score (0 to 100). Bands and capacities are under Other settings.">
            <Card pad={false}>
              <ul className="divide-y divide-line">{data.risk_factors.map((f) => (
                <WeightRow key={`${f.code}${f.weight}`} f={f} total={data.risk_factors.reduce((t, x) => t + x.weight, 0)} ro={ro} />
              ))}</ul>
            </Card>
          </Section>

          <Section id="actions" title="Recommended actions"
            description="When a case is at risk, the best matching rule suggests an action. A permitted official approves or dismisses it; nothing runs by itself.">
            <Card pad={false}>
              <ul className="divide-y divide-line">{data.intervention_rules.map((r) => (
                <InterventionRow key={`${r.code}${r.version}`} r={r} ro={ro} />
              ))}</ul>
            </Card>
          </Section>

          <Section id="templates" title="Message templates" description="Placeholders in braces, such as {ref} or {due_date}, are filled in automatically. Emails and SMS are simulated.">
            <Card pad={false}>
              <Table minWidth={760}>
                <thead><tr><th>Template</th><th>Subject</th><th>SMS</th><th /></tr></thead>
                <tbody>{data.templates.map((t) => (
                  <tr key={t.code}><td className="font-medium">{t.label}</td><td className="text-[13px]">{t.subject}</td>
                    <td className="max-w-[260px] text-[12.5px] text-ink-soft">{t.sms}</td><td>{!ro && <Button small onClick={() => setEditTpl(t)}><Pencil size={13} /> Edit</Button>}</td></tr>
                ))}</tbody>
              </Table>
            </Card>
          </Section>

          <Section id="settings" title="Other settings">
            <Card pad={false}>
              <ul className="divide-y divide-line">{data.settings.map((s) => <SettingRow key={`${s.key}${s.value}`} s={s} ro={ro} />)}</ul>
            </Card>
          </Section>

          <Section id="history" title="Change history" description="The latest changes and who made them.">
            <div className="surface px-4 py-2">
              <Collapsible title={`Show changes (${history.data?.rows.length ?? 0})`}>
              {history.data?.rows.length ? (
                <ol className="divide-y divide-line pb-1">
                  {history.data.rows.map((c) => (
                    <li key={c.id} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-2.5 sm:grid-cols-[140px_200px_minmax(0,1fr)]">
                      <span className="mono text-[12px] text-ink-soft">{fmtDateTime(c.at)}</span>
                      <span className="flex min-w-0 items-center gap-2 text-[13px]"><Avatar name={c.actor_label} /><span className="truncate">{c.actor_label.split(" (")[0]}</span></span>
                      <span className="col-span-2 text-[13px] sm:col-span-1">
                        <span className="font-medium">{c.details.rule ?? "rule"}</span> <span className="mono text-[12px] text-ink-soft">{c.details.key}</span>:{" "}
                        <span className="mono text-[12px] text-ink-soft line-through">{JSON.stringify(c.details.before)}</span> → <span className="mono text-[12px] text-brand-hover">{JSON.stringify(c.details.after)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <Empty title="No rule changes yet.">Every change made on this page is listed here with who made it and when.</Empty>}
              </Collapsible>
            </div>
          </Section>
        </div>
      </DocLayout>
      {editTpl && <TemplateModal t={editTpl} close={() => setEditTpl(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- routes */
function RouteCard({ route, stages, ro, today, slaOf }: {
  route: Rules["routes"][number]; stages: Rules["stages"]; ro: boolean; today: string; slaOf: (s: string) => number;
}) {
  const [edit, setEdit] = useState(false);
  const [list, setList] = useState(route.stages);
  const [drag, setDrag] = useState<number | null>(null);
  const dirty = list.join() !== route.stages.join();
  const fixed = (i: number) => i === 0 || i === list.length - 1;
  const moveTo = (from: number, to: number) => {
    if (fixed(from) || to < 1 || to > list.length - 2 || from === to) return;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setList(next);
  };
  const toggle = (code: string) => setList(list.includes(code) ? list.filter((s) => s !== code) : [...list.slice(0, -1), code, list[list.length - 1]]);
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); moveTo(i, i - 1); }
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); moveTo(i, i + 1); }
  };
  const middle = stages.filter((s) => s.code !== "intake" && s.code !== "decision");
  let day = 0;
  const ends = list.map((s) => (day += slaOf(s)));

  return (
    <div className="surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-[14.5px] font-semibold">{route.name}</div><div className="text-[12.5px] text-ink-soft">{route.description}</div></div>
        {!ro && !edit && <Button small onClick={() => setEdit(true)}><Pencil size={13} /> Edit</Button>}
      </div>
      <ol className="mt-3 flex flex-wrap items-center gap-1.5" aria-label={`Stages of ${route.name}`}>
        {list.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-3 bg-line-strong" aria-hidden />}
            <span tabIndex={edit && !fixed(i) ? 0 : undefined} draggable={edit && !fixed(i)}
              onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} onDragOver={(e) => { if (edit && drag != null) e.preventDefault(); }}
              onDrop={() => { if (drag != null) moveTo(drag, i); setDrag(null); }} onKeyDown={(e) => edit && onKey(e, i)}
              aria-label={edit && !fixed(i) ? `${STAGE_NAME[s]}, position ${i + 1}. Use arrow keys to move.` : undefined}
              className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium transition-[transform,box-shadow] ${
                fixed(i) ? "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line"
                : edit ? `cursor-grab bg-brand-tint text-brand-hover ring-1 ring-inset ring-brand/30 active:cursor-grabbing ${drag === i ? "scale-95 opacity-60" : "hover:-translate-y-0.5"}`
                : "bg-brand-tint text-brand-hover"}`}>
              {edit && !fixed(i) && <GripVertical size={12} aria-hidden />}{STAGE_NAME[s]}
              {edit && !fixed(i) && <button type="button" onClick={() => toggle(s)} aria-label={`Remove ${STAGE_NAME[s]}`} className="-mr-1 rounded-full p-0.5 hover:bg-white/70"><X size={11} /></button>}
            </span>
          </li>
        ))}
      </ol>
      {edit && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <span className="text-[12px] text-ink-soft">Add a stage:</span>
          {middle.filter((s) => !list.includes(s.code)).map((s) => (
            <button key={s.code} type="button" onClick={() => toggle(s.code)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-[12.5px] text-ink-soft hover:border-brand hover:text-brand">
              <Plus size={12} />{s.name}
            </button>
          ))}
          {middle.every((s) => list.includes(s.code)) && <span className="text-[12px] text-ink-soft">all stages are in this route</span>}
        </div>
      )}
      <Preview>
        If every stage used its full time limit, a case submitted today would reach its decision by{" "}
        <b className="mono font-medium text-ink">{fmtDate(addDays(today, ends.at(-1) ?? 0))}</b>
        <span className="mono"> ({ends.at(-1)} days)</span>. Time waiting on the institution is extra.
      </Preview>
      {edit && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[12px] text-ink-soft">Cases already submitted keep the route they started with.</span>
          <span className="flex gap-1.5">
            <Button small onClick={() => { setList(route.stages); setEdit(false); }}>Cancel</Button>
            <Button small kind="primary" disabled={!dirty} onClick={async () => { if (await save(`/api/rules/routes/${route.code}`, { stages: list }, "Route saved. New applications follow it.")) setEdit(false); }}>
              <Save size={13} /> Save route</Button>
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- rows */
function SlaRow({ s, ro, today }: { s: Rules["sla"][number]; ro: boolean; today: string }) {
  const [v, setV] = useState(s.days);
  return (
    <li className="grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="text-[13.5px] font-medium">{s.label}</span><Stamp tone="neutral">waits on {s.waits_on}</Stamp></div>
        <div className="text-[12.5px] text-ink-soft">{s.description}</div>
        <div className="mt-1 text-[12px] text-ink-soft">Started today, due <span className="mono font-medium text-ink">{fmtDate(addDays(today, v))}</span></div>
      </div>
      <span className="flex items-center gap-2">
        <Stepper value={v} onChange={setV} min={1} max={365} disabled={ro} label={`${s.label} days`} suffix="days" />
        <SaveBar dirty={v !== s.days} onReset={() => setV(s.days)} onSave={() => void save(`/api/rules/sla/${s.code}`, { days: v }, `${s.label}: ${v} days.`)} />
      </span>
    </li>
  );
}

function ReminderRow({ e, active, ro, due, what }: {
  e: { code: string; label: string }; active: Rules["reminders"]; ro: boolean; due: string; what: string;
}) {
  const init = active.filter((r) => r.kind === "reminder").map((r) => -r.offset_days).sort((a, b) => b - a);
  const overdueInit = active.find((r) => r.kind === "overdue")?.offset_days ?? 1;
  const [before, setBefore] = useState<number[]>(init);
  const [overdue, setOverdue] = useState(overdueInit);
  const [add, setAdd] = useState(3);
  const dirty = before.join() !== init.join() || overdue !== overdueInit;
  const sorted = [...before].sort((a, b) => b - a);
  const reset = () => { setBefore(init); setOverdue(overdueInit); };
  const submit = () => void save(`/api/rules/reminders/${e.code}`, { offsets: sorted.map((d) => -d), overdue }, `Reminder days for ${e.label.toLowerCase()} updated.`);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-medium">{e.label}</div>
        </div>
        <SaveBar dirty={dirty} onReset={reset} onSave={submit} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] text-ink-soft">Remind</span>
        {sorted.map((d) => (
          <span key={d} className="mono inline-flex h-7 items-center gap-1 rounded-full bg-warn-tint pl-2.5 pr-1 text-[12px] text-warn-ink ring-1 ring-inset ring-warn/25">
            {d === 0 ? "on the day" : `${d}d before`}
            {!ro && <button type="button" onClick={() => setBefore(before.filter((x) => x !== d))} aria-label={`Remove reminder ${d} days before`} className="rounded-full p-0.5 hover:bg-white/70"><X size={11} /></button>}
          </span>
        ))}
        {!ro && (
          <span className="inline-flex items-center gap-1">
            <Stepper value={add} onChange={setAdd} min={0} max={180} label={`New reminder for ${e.label}`} suffix="d before" />
            <Button small kind="ghost" disabled={before.includes(add)} onClick={() => setBefore([...before, add])}><Plus size={13} /> Add</Button>
          </span>
        )}
        <span className="ml-3 mr-1 text-[12px] text-ink-soft">Overdue alert</span>
        <Stepper value={overdue} onChange={setOverdue} min={1} max={30} disabled={ro} label={`Overdue alert day for ${e.label}`} suffix="d after" />
      </div>
      <Preview>
        {what} is due <b className="mono font-medium text-ink">{short(due)}</b>. It would get
        {sorted.length ? <> reminders on <b className="mono font-medium text-ink">{sorted.map((d) => short(addDays(due, -d))).join(", ")}</b></> : " no reminders"}
        {" "}and the overdue alert on <b className="mono font-medium text-ink">{short(addDays(due, overdue))}</b>.
      </Preview>
    </li>
  );
}

function LevelRow({ l, targets, ro }: { l: Rules["escalation_levels"][number]; targets: Rules["escalation_targets"]; ro: boolean }) {
  const [title, setTitle] = useState(l.title);
  const [target, setTarget] = useState(l.target);
  const dirty = title !== l.title || target !== l.target;
  return (
    <li className="flex flex-wrap items-center gap-2.5 px-4 py-3">
      <span className="mono w-7 text-[13px] font-semibold text-esc">L{l.level}</span>
      <input className="field h-8 min-w-[200px] flex-1 py-0 text-[13px]" value={title} disabled={ro} onChange={(e) => setTitle(e.target.value)} aria-label={`Title for level ${l.level}`} />
      <select className="field h-8 w-auto py-0 text-[13px]" value={target} disabled={ro} onChange={(e) => setTarget(e.target.value)} aria-label={`Who level ${l.level} goes to`}>
        {targets.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
      </select>
      <SaveBar dirty={dirty} onReset={() => { setTitle(l.title); setTarget(l.target); }}
        onSave={() => void save(`/api/rules/escalation-levels/${l.level}`, { title, target }, `Level ${l.level} updated.`)} />
    </li>
  );
}

function EscDaysRow({ e, days, ro, due }: { e: { code: string; label: string }; days: number[]; ro: boolean; due: string }) {
  const [v, setV] = useState(days);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13.5px] font-medium">{e.label}</span>
        <SaveBar dirty={v.join() !== days.join()} onReset={() => setV(days)}
          onSave={() => void save(`/api/rules/escalation-days/${e.code}`, { days: v }, `Escalation days for ${e.label.toLowerCase()} updated.`)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {v.map((d, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className="mono text-[12px] font-semibold text-esc">L{i + 1}</span>
            <Stepper value={d} onChange={(n) => setV(v.map((x, j) => (j === i ? n : x)))} min={1} max={180} disabled={ro} label={`L${i + 1} days after due for ${e.label}`} suffix="d" />
          </span>
        ))}
      </div>
      <Preview>
        If still open after a due date of <span className="mono">{short(due)}</span>: {v.map((d, i) => <span key={i}><b className="font-medium text-esc">L{i + 1}</b> <span className="mono text-ink">{short(addDays(due, d))}</span>{i < v.length - 1 ? ", " : "."}</span>)}
        {v.some((d, i) => i > 0 && d <= v[i - 1]) && <span className="ml-1 font-medium text-warn-ink">Each level should come after the one before.</span>}
      </Preview>
    </li>
  );
}

const AUTH: Record<string, string> = { regional: "Regional officer", regional_or_bureau: "Regional or Bureau officer", bureau: "Bureau officer" };

function WeightRow({ f, total, ro }: { f: Rules["risk_factors"][number]; total: number; ro: boolean }) {
  const [w, setW] = useState(f.weight);
  return (
    <li className="grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <div><div className="text-[13.5px] font-medium">{f.label}</div><div className="text-[12.5px] text-ink-soft">{f.description}</div></div>
      <span className="flex items-center gap-2">
        <span className="mono w-[64px] text-right text-[12px] text-ink-soft">{total ? Math.round((100 * f.weight) / total) : 0}% now</span>
        <Stepper value={w} onChange={setW} min={0} max={100} disabled={ro} label={`${f.label} weight`} suffix="pts" />
        <SaveBar dirty={w !== f.weight} onReset={() => setW(f.weight)}
          onSave={() => void save(`/api/rules/risk-factors/${f.code}`, { weight: w }, `${f.label}: weight ${w}.`)} />
      </span>
    </li>
  );
}

function InterventionRow({ r, ro }: { r: Rules["intervention_rules"][number]; ro: boolean }) {
  const [active, setActive] = useState(r.active);
  const [threshold, setThreshold] = useState(r.threshold);
  const [saved, setSaved] = useState(r.est_days_saved);
  const dirty = active !== r.active || threshold !== r.threshold || saved !== r.est_days_saved;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">{r.label}
            <span className="mono text-[11.5px] font-normal text-ink-soft">v{r.version}</span>
            {!r.active && <Stamp tone="neutral">Off</Stamp>}</div>
          <div className="text-[12.5px] text-ink-soft">When: {r.trigger_text}. Then: {r.action_text.charAt(0).toLowerCase() + r.action_text.slice(1)}. Approved by: {AUTH[r.authorized_by]}.</div>
        </div>
        <SaveBar dirty={dirty} onReset={() => { setActive(r.active); setThreshold(r.threshold); setSaved(r.est_days_saved); }}
          onSave={() => void save(`/api/rules/interventions/${r.code}`, { active, threshold, est_days_saved: saved }, `${r.label} updated (version ${r.version + 1}).`)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-soft">
        <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[var(--brand)]" checked={active} disabled={ro}
          onChange={(e) => setActive(e.target.checked)} /> On</label>
        <span className="flex items-center gap-1.5">N = {r.threshold_label.toLowerCase()}
          <Stepper value={threshold} onChange={setThreshold} min={0} max={365} disabled={ro} label={`${r.label} threshold`} /></span>
        <span className="flex items-center gap-1.5">Days saved (estimate)
          <Stepper value={saved} onChange={setSaved} min={0} max={60} disabled={ro} label={`${r.label} estimated days saved`} /></span>
      </div>
    </li>
  );
}

function SettingRow({ s, ro }: { s: Rules["settings"][number]; ro: boolean }) {
  const [v, setV] = useState(Number(s.value));
  return (
    <li className="grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <div><div className="text-[13.5px] font-medium">{s.label}</div><div className="text-[12.5px] text-ink-soft">{s.description}</div></div>
      <span className="flex items-center gap-2">
        <Stepper value={v} onChange={setV} min={0} max={365} disabled={ro} label={s.label} />
        <SaveBar dirty={v !== Number(s.value)} onReset={() => setV(Number(s.value))} onSave={() => void save(`/api/rules/settings/${s.key}`, { value: v }, `${s.label}: ${v}.`)} />
      </span>
    </li>
  );
}

function TemplateModal({ t, close }: { t: Rules["templates"][number]; close: () => void }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [sms, setSms] = useState(t.sms);
  return (
    <Modal wide title={`Template: ${t.label}`} onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" onClick={async () => { if (await save(`/api/rules/templates/${t.code}`, { subject, body, sms }, "Template saved.")) close(); }}>Save template</Button></>}>
      <Field label="Email subject"><input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Email and in-app text"><textarea className="field" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <Field label={`SMS (${sms.length}/160)`}><input className="field" maxLength={160} value={sms} onChange={(e) => setSms(e.target.value)} /></Field>
    </Modal>
  );
}
