"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { FilePlus2, Search } from "lucide-react";
import { Button, Card, DueCell, Empty, ErrorNote, Field, HelpBox, Modal, NextStep, PageHeader, PageSkeleton, SlaStamp, Table } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { DECISION_TEXT, STAGE_NAME } from "@/lib/labels";
import { toast, useApp } from "@/lib/store";

interface Row {
  id: number; ref_no: string; status: string; decision: string | null; submitted_at: string; programme: string;
  institution: string; region: string; region_id: number; type_name: string; stage_code: string; stage_name: string;
  sla_status: string; substatus_text: string; due_date: string | null; days_to_due: number | null; age_days: number | null;
  waiting_on: string | null; escalation_level: number | null; assignee: string | null;
}

function ApplicationsInner() {
  const user = useApp((s) => s.user)!;
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState(params.get("status") ?? (user.role === "official" ? "in_progress" : ""));
  const [sla, setSla] = useState(params.get("sla") ?? "");
  const [stage, setStage] = useState("");
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQD] = useState("");
  const [creating, setCreating] = useState(params.get("new") === "1");
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
  const regions = useApi<{ id: number; name: string }[]>(user.role === "official" ? "/api/regions" : null);
  const inst = user.role === "institution";

  return (
    <div>
      <PageHeader title={inst ? "My applications" : "Applications"}
        description={inst ? "Every application your institution has submitted, where it is now, and what it is waiting for." : "Find any case by Region, stage or deadline status. Click a row to open the case."}
        action={inst ? <Button kind="primary" onClick={() => setCreating(true)}><FilePlus2 size={16} /> New application</Button> : undefined} />
      <HelpBox id={inst ? "apps-inst" : "apps-official"}>
        {inst ? "Submit a new application with the button on the right. Argus picks the route for its type and sends it to the right officer automatically."
          : "Use the filters to narrow the list. Overdue cases carry a red OVERDUE stamp; escalated ones show their level (L1 to L3)."}
      </HelpBox>

      <div className="sheet mb-4 grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="relative xl:col-span-2">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input className="input pl-8" placeholder="Search reference, institution or programme" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </label>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="in_progress">In progress</option><option value="decided">Decided</option>
        </select>
        <select className="input" value={sla} onChange={(e) => setSla(e.target.value)} aria-label="Deadline status">
          <option value="">Any deadline status</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option><option value="on_track">On track</option>
        </select>
        <div className="flex gap-2">
          <select className="input" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
            <option value="">All stages</option>{Object.entries(STAGE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {!inst && (
            <select className="input" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
              <option value="">All Regions</option>{regions.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading ? <PageSkeleton /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <Card title={`${data!.total} application${data!.total === 1 ? "" : "s"}`} pad={false}>
          {data!.rows.length ? (
            <Table minWidth={980}>
              <thead><tr><th>Reference</th>{!inst && <th>Institution</th>}<th>Type</th><th>Stage</th><th>With</th><th className="num">Age</th><th>Next due</th><th>Status</th></tr></thead>
              <tbody>
                {data!.rows.map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => router.push(`/applications/${r.id}`)}>
                    <td><Link href={`/applications/${r.id}`} className="font-semibold no-underline">{r.ref_no}</Link><div className="max-w-[220px] truncate text-[12.5px] text-ink-soft">{r.programme}</div></td>
                    {!inst && <td><div className="max-w-[230px]">{r.institution}</div><div className="text-[12.5px] text-ink-soft">{r.region}</div></td>}
                    <td className="max-w-[180px]">{r.type_name}</td>
                    <td>{r.status === "decided" ? DECISION_TEXT[r.decision ?? ""] : <>{r.stage_name}<div className="text-[12.5px] text-ink-soft">{r.substatus_text}</div></>}</td>
                    <td className="text-[13.5px]">{r.waiting_on === "institution" ? "Institution" : r.assignee ?? "–"}</td>
                    <td className="num">{r.age_days ?? "–"}</td>
                    <td><DueCell date={r.due_date} days={r.days_to_due} fmt={fmtDate} /></td>
                    <td><SlaStamp status={r.sla_status} days={r.days_to_due} level={r.escalation_level} waitingOn={r.waiting_on} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="No applications match these filters.">Clear a filter or search for something else.</Empty>}
        </Card>
      )}
      {creating && <NewApplication close={() => setCreating(false)} />}
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
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {types.data?.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
      </Field>
      {chosen && (
        <div className="rounded-md border border-line bg-paper/50 p-3 text-[13.5px]">
          <div className="mb-1.5 font-semibold">Route: {chosen.route_name}</div>
          <ol className="flex flex-wrap items-center gap-1.5">
            {chosen.stages.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5"><span className="rounded border border-line bg-card px-2 py-0.5">{i + 1}. {s}</span>{i < chosen.stages.length - 1 && <span className="text-ink-soft">→</span>}</li>
            ))}
          </ol>
          <div className="mt-1.5 text-[12px] text-ink-soft">Routes come from the Rules page (illustrative, not official APH).</div>
        </div>
      )}
      <Field label="Programme or proposal" hint="For example: B.Tech Computer Science and Engineering (60 seats)">
        <input className="input" value={programme} onChange={(e) => setProgramme(e.target.value)} />
      </Field>
    </Modal>
  );
}

export default function ApplicationsPage() {
  return <Suspense fallback={<PageSkeleton />}><ApplicationsInner /></Suspense>;
}
