"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Info, Pencil, Save } from "lucide-react";
import { Button, Card, ErrorNote, Field, HelpBox, Modal, PageHeader, PageSkeleton, Stamp, Table, Tabs } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { STAGE_NAME } from "@/lib/labels";
import { toast, useApp } from "@/lib/store";

interface Rules {
  illustrative_notice: string; can_edit: boolean;
  sla: { code: string; label: string; days: number; waits_on: string; description: string }[];
  stages: { code: string; name: string }[];
  routes: { code: string; name: string; description: string; stages: string[] }[];
  application_types: { code: string; name: string; route_code: string }[];
  reminders: { id: number; entity_type: string; kind: string; offset_days: number; active: boolean; effective_from: string }[];
  escalation_levels: { level: number; title: string; target: string }[];
  escalation_rules: { entity_type: string; level: number; days_after_due: number }[];
  templates: { code: string; label: string; subject: string; body: string; sms: string }[];
  settings: { key: string; value: number; label: string; description: string }[];
  entity_types: { code: string; label: string }[];
  escalation_targets: { code: string; label: string }[];
}

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

function NumberEdit({ value, onSave, disabled, min = 1, max = 365 }: { value: number; onSave: (v: number) => Promise<boolean>; disabled: boolean; min?: number; max?: number }) {
  const [v, setV] = useState(value);
  const dirty = v !== value;
  return (
    <span className="inline-flex items-center gap-1.5">
      <input type="number" className="input w-[84px] py-1" min={min} max={max} value={v} disabled={disabled} onChange={(e) => setV(Number(e.target.value))} />
      {dirty && <Button small kind="primary" onClick={() => onSave(v)}><Save size={13} /> Save</Button>}
    </span>
  );
}

export default function RulesPage() {
  const user = useApp((s) => s.user)!;
  const { data, error, loading, reload } = useApi<Rules>(user.role === "official" ? "/api/rules" : null);
  const [tab, setTab] = useState("routes");
  const [editRoute, setEditRoute] = useState<Rules["routes"][number] | null>(null);
  const [editTpl, setEditTpl] = useState<Rules["templates"][number] | null>(null);
  if (user.role !== "official") return <ErrorNote error={{ message: "Rules are maintained by Bureau officers." }} />;
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "No data" }} onRetry={reload} />;
  const ro = !data.can_edit;

  return (
    <div>
      <PageHeader kicker="Bureau officers" title="Rules and timelines" description="Routes, time limits, reminder days, the escalation chain and message templates. Changes apply at once, with no code change, and every change is audited." />
      <div className="sheet mb-4 flex items-start gap-3 border-l-4 border-l-ochre px-4 py-3 text-[14px]">
        <Info size={18} className="mt-0.5 shrink-0 text-ochre-ink" />
        <div><b>Illustrative values.</b> {data.illustrative_notice} {ro && "You can view these rules; only Bureau officers can change them."}</div>
      </div>
      <HelpBox id="rules">Change a number and press Save. New reminder days take effect from today, so they never fire late for days already passed. Open the Audit trail to see who changed what.</HelpBox>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "routes", label: "Routes" }, { id: "sla", label: "Time limits" }, { id: "reminders", label: "Reminders" },
        { id: "escalation", label: "Escalation chain" }, { id: "templates", label: "Message templates" }, { id: "settings", label: "Other settings" },
      ]} />

      {tab === "routes" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Routes" subtitle="Ordered stages a case passes through" pad={false}>
            <Table>
              <thead><tr><th>Route</th><th>Stages in order</th><th /></tr></thead>
              <tbody>{data.routes.map((r) => (
                <tr key={r.code}><td><b>{r.name}</b><div className="text-[12px] text-ink-soft">{r.code}</div></td>
                  <td className="text-[13px]">{r.stages.map((s) => STAGE_NAME[s]).join(" → ")}</td>
                  <td>{!ro && <Button small onClick={() => setEditRoute(r)}><Pencil size={13} /> Edit</Button>}</td></tr>
              ))}</tbody>
            </Table>
          </Card>
          <Card title="Application types" subtitle="Which route each type follows" pad={false}>
            <Table>
              <thead><tr><th>Type</th><th>Route</th></tr></thead>
              <tbody>{data.application_types.map((t) => (
                <tr key={t.code}><td>{t.name}</td><td>
                  <select className="input py-1" value={t.route_code} disabled={ro}
                    onChange={(e) => save(`/api/rules/application-types/${t.code}`, { route_code: e.target.value }, `${t.name} now follows ${e.target.value}.`)}>
                    {data.routes.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select></td></tr>
              ))}</tbody>
            </Table>
          </Card>
        </div>
      )}

      {tab === "sla" && (
        <Card title="Time limits (days)" subtitle="Used to compute every due date" pad={false}>
          <Table>
            <thead><tr><th>Limit</th><th>Waits on</th><th>Days</th><th>Meaning</th></tr></thead>
            <tbody>{data.sla.map((s) => (
              <tr key={s.code}><td><b>{s.label}</b></td><td><Stamp tone="neutral">{s.waits_on}</Stamp></td>
                <td><NumberEdit key={`${s.code}${s.days}`} value={s.days} disabled={ro} onSave={(v) => save(`/api/rules/sla/${s.code}`, { days: v }, `${s.label}: ${v} days.`)} /></td>
                <td className="text-[13px] text-ink-soft">{s.description}</td></tr>
            ))}</tbody>
          </Table>
        </Card>
      )}

      {tab === "reminders" && (
        <Card title="Reminder and overdue alert days" subtitle="Negative numbers are days before the due date; the overdue alert is days after it" pad={false}>
          <Table>
            <thead><tr><th>Item</th><th>Reminders (days before due)</th><th>Overdue alert (days after)</th><th /></tr></thead>
            <tbody>{data.entity_types.map((e) => <ReminderRow key={e.code + data.reminders.filter((r) => r.entity_type === e.code && r.active).map((r) => r.offset_days).join()} e={e} rules={data.reminders} ro={ro} />)}</tbody>
          </Table>
        </Card>
      )}

      {tab === "escalation" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Escalation chain" subtitle="Who is alerted at each level" pad={false}>
            <Table>
              <thead><tr><th>Level</th><th>Title</th><th>Goes to</th></tr></thead>
              <tbody>{data.escalation_levels.map((l) => <LevelRow key={`${l.level}${l.title}${l.target}`} l={l} targets={data.escalation_targets} ro={ro} />)}</tbody>
            </Table>
          </Card>
          <Card title="Days after due before each level" pad={false}>
            <Table>
              <thead><tr><th>Item</th><th>L1</th><th>L2</th><th>L3</th><th /></tr></thead>
              <tbody>{data.entity_types.map((e) => {
                const days = data.escalation_rules.filter((r) => r.entity_type === e.code).sort((a, b) => a.level - b.level).map((r) => r.days_after_due);
                return <EscDaysRow key={e.code + days.join()} e={e} days={days} ro={ro} />;
              })}</tbody>
            </Table>
          </Card>
        </div>
      )}

      {tab === "templates" && (
        <Card title="Message templates" subtitle="Placeholders in braces, such as {ref} or {due_date}, are filled in automatically" pad={false}>
          <Table>
            <thead><tr><th>Template</th><th>Subject</th><th>SMS</th><th /></tr></thead>
            <tbody>{data.templates.map((t) => (
              <tr key={t.code}><td><b>{t.label}</b><div className="text-[12px] text-ink-soft">{t.code}</div></td><td className="text-[13px]">{t.subject}</td>
                <td className="max-w-[260px] text-[13px] text-ink-soft">{t.sms}</td><td>{!ro && <Button small onClick={() => setEditTpl(t)}><Pencil size={13} /> Edit</Button>}</td></tr>
            ))}</tbody>
          </Table>
        </Card>
      )}

      {tab === "settings" && (
        <Card title="Other settings" pad={false}>
          <Table>
            <thead><tr><th>Setting</th><th>Value</th><th>Meaning</th></tr></thead>
            <tbody>{data.settings.map((s) => (
              <tr key={s.key}><td><b>{s.label}</b></td>
                <td><NumberEdit key={`${s.key}${s.value}`} value={Number(s.value)} min={0} disabled={ro} onSave={(v) => save(`/api/rules/settings/${s.key}`, { value: v }, `${s.label}: ${v}.`)} /></td>
                <td className="text-[13px] text-ink-soft">{s.description}</td></tr>
            ))}</tbody>
          </Table>
        </Card>
      )}

      {editRoute && <RouteModal route={editRoute} stages={data.stages} close={() => setEditRoute(null)} />}
      {editTpl && <TemplateModal t={editTpl} close={() => setEditTpl(null)} />}
    </div>
  );
}

function ReminderRow({ e, rules, ro }: { e: { code: string; label: string }; rules: Rules["reminders"]; ro: boolean }) {
  const active = rules.filter((r) => r.entity_type === e.code && r.active);
  const initial = active.filter((r) => r.kind === "reminder").map((r) => r.offset_days).sort((a, b) => a - b).join(", ");
  const overdueInit = active.find((r) => r.kind === "overdue")?.offset_days ?? 1;
  const [text, setText] = useState(initial);
  const [overdue, setOverdue] = useState(overdueInit);
  const dirty = text !== initial || overdue !== overdueInit;
  const since = active.map((r) => r.effective_from).sort().at(-1);
  const submit = () => {
    const offsets = text.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
    if (offsets.some((n) => Number.isNaN(n))) { toast.error("Write the reminder days as numbers separated by commas, e.g. -30, -7, -1"); return; }
    void save(`/api/rules/reminders/${e.code}`, { offsets, overdue }, `Reminder days for ${e.label.toLowerCase()} updated.`);
  };
  return (
    <tr>
      <td><b>{e.label}</b><div className="text-[12px] text-ink-soft">effective since {fmtDate(since)}</div></td>
      <td><input className="input max-w-[220px] py-1" value={text} disabled={ro} onChange={(ev) => setText(ev.target.value)} aria-label={`Reminder days for ${e.label}`} /></td>
      <td><input type="number" min={1} max={30} className="input w-[84px] py-1" value={overdue} disabled={ro} onChange={(ev) => setOverdue(Number(ev.target.value))} aria-label="Overdue alert day" /></td>
      <td>{dirty && <Button small kind="primary" onClick={submit}><Save size={13} /> Save</Button>}</td>
    </tr>
  );
}

function LevelRow({ l, targets, ro }: { l: Rules["escalation_levels"][number]; targets: Rules["escalation_targets"]; ro: boolean }) {
  const [title, setTitle] = useState(l.title);
  const [target, setTarget] = useState(l.target);
  const dirty = title !== l.title || target !== l.target;
  return (
    <tr>
      <td><Stamp tone="escalated" level={l.level} /></td>
      <td><input className="input py-1" value={title} disabled={ro} onChange={(e) => setTitle(e.target.value)} aria-label={`Title for level ${l.level}`} /></td>
      <td className="flex items-center gap-1.5">
        <select className="input py-1" value={target} disabled={ro} onChange={(e) => setTarget(e.target.value)} aria-label={`Target for level ${l.level}`}>
          {targets.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
        {dirty && <Button small kind="primary" onClick={() => save(`/api/rules/escalation-levels/${l.level}`, { title, target }, `Level ${l.level} updated.`)}><Save size={13} /></Button>}
      </td>
    </tr>
  );
}

function EscDaysRow({ e, days, ro }: { e: { code: string; label: string }; days: number[]; ro: boolean }) {
  const [v, setV] = useState(days);
  const dirty = v.join() !== days.join();
  return (
    <tr>
      <td className="text-[13.5px]">{e.label}</td>
      {v.map((d, i) => (
        <td key={i}><input type="number" min={1} className="input w-[70px] py-1" value={d} disabled={ro} aria-label={`L${i + 1} days`}
          onChange={(ev) => setV(v.map((x, j) => (j === i ? Number(ev.target.value) : x)))} /></td>
      ))}
      <td>{dirty && <Button small kind="primary" onClick={() => save(`/api/rules/escalation-days/${e.code}`, { days: v }, `Escalation days for ${e.label.toLowerCase()} updated.`)}><Save size={13} /></Button>}</td>
    </tr>
  );
}

function RouteModal({ route, stages, close }: { route: Rules["routes"][number]; stages: Rules["stages"]; close: () => void }) {
  const [list, setList] = useState(route.stages);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 1 || j >= list.length - 1) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  const toggle = (code: string) => {
    if (list.includes(code)) setList(list.filter((s) => s !== code));
    else setList([...list.slice(0, -1), code, list[list.length - 1]]);
  };
  const middle = stages.filter((s) => s.code !== "intake" && s.code !== "decision");
  return (
    <Modal title={`Edit route: ${route.name}`} onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" onClick={async () => { if (await save(`/api/rules/routes/${route.code}`, { stages: list }, "Route saved. New applications follow it.")) close(); }}>Save route</Button></>}>
      <p className="text-[13.5px] text-ink-soft">A route always starts with the completeness check and ends with the decision. Cases already submitted keep the route they started with.</p>
      <div className="flex flex-wrap gap-2">{middle.map((s) => (
        <label key={s.code} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[13.5px]"><input type="checkbox" checked={list.includes(s.code)} onChange={() => toggle(s.code)} />{s.name}</label>
      ))}</div>
      <ol className="space-y-1.5">{list.map((s, i) => (
        <li key={s} className="flex items-center justify-between rounded-md border border-line bg-paper/50 px-3 py-1.5 text-[14px]">
          <span>{i + 1}. {STAGE_NAME[s]}</span>
          {i > 0 && i < list.length - 1 && <span className="flex gap-1"><button aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp size={15} /></button><button aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown size={15} /></button></span>}
        </li>
      ))}</ol>
    </Modal>
  );
}

function TemplateModal({ t, close }: { t: Rules["templates"][number]; close: () => void }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [sms, setSms] = useState(t.sms);
  return (
    <Modal wide title={`Template: ${t.label}`} onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" onClick={async () => { if (await save(`/api/rules/templates/${t.code}`, { subject, body, sms }, "Template saved.")) close(); }}>Save template</Button></>}>
      <Field label="Email subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Email and in-app text"><textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <Field label={`SMS (${sms.length}/160)`}><input className="input" maxLength={160} value={sms} onChange={(e) => setSms(e.target.value)} /></Field>
    </Modal>
  );
}
