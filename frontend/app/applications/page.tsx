"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, Search } from "lucide-react";
import { CasePreview } from "@/components/case/CasePreview";
import { SlaBar, rowSla, useReminderTicks, type StageWindow } from "@/components/viz/SlaBar";
import {
  Button, Card, DueCell, Empty, ErrorNote, Field, FilterChips, HelpBox, Modal, NextStep, Owner, PageHeader, PageSkeleton,
  SlaStamp, Stamp, Table, Tabs, useRowNav, type Chip,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { DECISION_TEXT, STAGE_NAME } from "@/lib/labels";
import { toast, useApp } from "@/lib/store";

interface Row extends StageWindow {
  id: number; ref_no: string; status: string; decision: string | null; submitted_at: string; programme: string;
  institution: string; region: string; region_id: number; type_name: string; stage_code: string; stage_name: string;
  sla_status: string; substatus_text: string; due_date: string | null; days_to_due: number | null; age_days: number | null;
  waiting_on: string | null; escalation_level: number | null; assignee: string | null;
}

const SLA_TEXT: Record<string, string> = { overdue: "Overdue", due_soon: "Due soon", on_track: "On track" };

function ApplicationsInner() {
  const user = useApp((s) => s.user)!;
  const today = useApp((s) => s.clock?.today);
  const params = useSearchParams();
  const inst = user.role === "institution";
  const [status, setStatus] = useState(params.get("status") ?? (inst ? "" : "in_progress"));
  const [sla, setSla] = useState(params.get("sla") ?? "");
  const [stage, setStage] = useState(params.get("stage") ?? "");
  const [region, setRegion] = useState(params.get("region_id") ?? "");
  const [q, setQ] = useState("");
  const [qDebounced, setQD] = useState("");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [preview, setPreview] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setQD(q), 300); return () => clearTimeout(t); }, [q]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (sla) p.set("sla", sla);
    if (stage) p.set("stage", stage);
    if (region) p.set("region_id", region);
    if (qDebounced) p.set("q", qDebounced);
    return p.toString();
  }, [status, sla, stage, region, qDebounced]);
  const { data, error, loading, reload } = useApi<{ rows: Row[]; total: number }>(`/api/applications?${qs}`);
  const regions = useApi<{ id: number; name: string }[]>(!inst ? "/api/regions" : null);
  const ticks = useReminderTicks();
  const rows = data?.rows ?? [];
  const open = useCallback((i: number) => setPreview(rows[i]?.id ?? null), [rows]);
  const rowProps = useRowNav(rows.length, open);

  const chips: Chip[] = [
    ...(sla ? [{ key: "sla", label: `Deadline: ${SLA_TEXT[sla]}`, onRemove: () => setSla("") }] : []),
    ...(stage ? [{ key: "stage", label: `Stage: ${STAGE_NAME[stage]}`, onRemove: () => setStage("") }] : []),
    ...(region ? [{ key: "region", label: `Region: ${regions.data?.find((r) => String(r.id) === region)?.name ?? region}`, onRemove: () => setRegion("") }] : []),
    ...(qDebounced ? [{ key: "q", label: `Search: “${qDebounced}”`, onRemove: () => { setQ(""); setQD(""); } }] : []),
  ];

  return (
    <div>
      <PageHeader crumbs={inst ? [{ label: "Institution", href: "/" }, { label: "Applications" }] : [{ label: "Cases" }, { label: "Applications" }]}
        title={inst ? "My applications" : "Applications"}
        description={inst ? "Every application your institution has submitted, where it is now, and what it is waiting for." : "Find any case by Region, stage or deadline. Click a row (or press Enter) for a quick look."}
        action={inst ? <Button kind="primary" onClick={() => setCreating(true)}><FilePlus2 size={15} /> New application</Button> : undefined} />
      <HelpBox id={inst ? "apps-inst" : "apps-official"}>
        {inst ? "Submit a new application with the button on the right. Argus picks the route for its type and sends it to an officer automatically."
          : "Narrow the list with the filters; each one appears as a chip you can remove. The bar in each row is the time used in the current stage against its limit."}
      </HelpBox>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden />
          <input className="field pl-8" placeholder="Search reference, institution or programme" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </label>
        <div className="[&>div]:mb-0">
          <Tabs value={status || "all"} onChange={(v) => setStatus(v === "all" ? "" : v)}
            tabs={[{ id: "all", label: "All" }, { id: "in_progress", label: "In progress" }, { id: "decided", label: "Decided" }]} />
        </div>
        <select className="field w-auto" value={sla} onChange={(e) => setSla(e.target.value)} aria-label="Deadline status">
          <option value="">Any deadline</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option><option value="on_track">On track</option>
        </select>
        <select className="field w-auto" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
          <option value="">Any stage</option>{Object.entries(STAGE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {!inst && (
          <select className="field w-auto" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            <option value="">All Regions</option>{regions.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
      </div>
      <FilterChips chips={chips} onClear={() => { setSla(""); setStage(""); setRegion(""); setQ(""); setQD(""); }} />

      {loading ? <PageSkeleton /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <Card title={<span><span className="mono">{data!.total}</span> application{data!.total === 1 ? "" : "s"}</span>}
          subtitle="Arrow keys move between rows; Enter opens a quick look" pad={false}>
          {rows.length ? (
            <Table minWidth={inst ? 900 : 1080} maxHeight={640}>
              <thead><tr>
                <th>Reference</th>{!inst && <th>Institution</th>}<th>Stage</th><th style={{ width: 150 }}>Time limit</th>
                <th>With</th><th className="num">Age</th><th>Next due</th><th>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const bar = today && r.status === "in_progress" ? rowSla(r, today) : null;
                  return (
                    <tr key={r.id} {...rowProps(i)} aria-label={`Preview ${r.ref_no}`}>
                      <td><span className="mono font-medium text-brand">{r.ref_no}</span><div className="max-w-[200px] truncate text-[12px] text-ink-soft">{r.programme}</div></td>
                      {!inst && <td><div className="max-w-[220px] truncate">{r.institution}</div><div className="text-[12px] text-ink-soft">{r.region} · {r.type_name}</div></td>}
                      <td>{r.status === "decided" ? DECISION_TEXT[r.decision ?? ""] : <>{r.stage_name}<div className="text-[12px] text-ink-soft">{r.substatus_text}</div></>}</td>
                      <td>{bar ? <SlaBar {...bar} ticks={ticks.stage} compact /> : <span className="text-ink-soft">–</span>}</td>
                      <td className="max-w-[160px]">{r.waiting_on === "institution" ? <span className="text-ink-soft">Institution</span> : <Owner name={r.assignee} />}</td>
                      <td className="num mono">{r.age_days ?? "–"}</td>
                      <td><DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} /></td>
                      <td>{r.status === "decided" ? <Stamp tone="closed">Decided</Stamp> : <SlaStamp status={r.sla_status} days={r.days_to_due} level={r.escalation_level} waitingOn={r.waiting_on} solid />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <Empty title="No applications match these filters." action={chips.length ? <Button small onClick={() => { setSla(""); setStage(""); setRegion(""); setQ(""); setQD(""); }}>Clear filters</Button> : undefined}>Try a different search or remove a filter.</Empty>}
        </Card>
      )}
      {creating && <NewApplication close={() => setCreating(false)} />}
      <CasePreview appId={preview} onClose={() => setPreview(null)} />
      <NextStep href={inst ? "/undertakings" : "/evc"} label={inst ? "undertakings" : "EVC scheduling board"} />
    </div>
  );
}

interface AppType { code: string; name: string; route_code: string; route_name: string; stages: string[] }

function NewApplication({ close }: { close: () => void }) {
  const router = useRouter();
  const types = useApi<AppType[]>("/api/application-types");
  const [type, setType] = useState("INTAKE");
  const [programme, setProgramme] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = types.data?.find((t) => t.code === type);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number; ref_no: string }>("/api/applications", { body: { app_type: type, programme, academic_year: "2026-27" } });
      toast.success(`Submitted as ${r.ref_no}. Argus has routed it to the completeness check.`);
      useApp.getState().bumpVersion();
      router.push(`/applications/${r.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal wide title="New application" onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button kind="primary" busy={busy} disabled={programme.trim().length < 5} onClick={submit}>Submit application</Button></>}>
      <Field label="Application type">
        <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
          {types.data?.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
      </Field>
      {chosen && (
        <div className="rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          <div className="mb-2 font-medium">Route: {chosen.route_name}</div>
          <ol className="flex flex-wrap items-center gap-1.5">
            {chosen.stages.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="rounded-full bg-surface px-2.5 py-0.5 ring-1 ring-inset ring-line"><span className="mono mr-1 text-ink-soft">{i + 1}</span>{s}</span>
                {i < chosen.stages.length - 1 && <span className="text-line-strong">›</span>}
              </li>
            ))}
          </ol>
          <div className="mt-2 text-[12px] text-ink-soft">Routes come from the Rules page (illustrative, not official APH).</div>
        </div>
      )}
      <Field label="Programme or proposal" hint="For example: B.Tech Computer Science and Engineering (60 seats)">
        <input className="field" value={programme} onChange={(e) => setProgramme(e.target.value)} />
      </Field>
    </Modal>
  );
}

export default function ApplicationsPage() {
  return <Suspense fallback={<PageSkeleton />}><ApplicationsInner /></Suspense>;
}
