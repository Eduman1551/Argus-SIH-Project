"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { Bot, Link2, ShieldAlert, ShieldCheck, User } from "lucide-react";
import { Button, Card, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Table } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { ACTION_TEXT } from "@/lib/labels";
import { toast, useApp } from "@/lib/store";

interface Entry { id: number; at: string; actor_label: string; actor_id: number | null; action: string; entity_type: string; entity_id: string;
  application_id: number | null; ref_no: string | null; details: Record<string, unknown>; prev_hash: string; hash: string }
interface Verify { valid: boolean; checked: number; broken_at: number | null; reason: string | null; head?: string }

export default function AuditPage() {
  const user = useApp((s) => s.user)!;
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [extra, setExtra] = useState<Entry[]>([]);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setQd(q), 300); return () => clearTimeout(t); }, [q]);
  const params = new URLSearchParams();
  if (group) params.set("action", group);
  if (qd) params.set("q", qd);
  const { data, error, loading, reload } = useApi<{ rows: Entry[]; total: number; action_groups: string[] }>(user.role === "official" ? `/api/audit?${params}` : null);
  useEffect(() => setExtra([]), [group, qd]);
  if (user.role !== "official") return <ErrorNote error={{ message: "The audit trail is visible to officials." }} />;

  const runVerify = async () => {
    setVerifying(true);
    try { setVerify(await api<Verify>("/api/audit/verify", { body: {} })); } catch (e) { toast.error((e as Error).message); }
    setVerifying(false);
  };
  const more = async () => {
    const last = [...(data?.rows ?? []), ...extra].at(-1);
    if (!last) return;
    const p = new URLSearchParams(params);
    p.set("before", String(last.id));
    const r = await api<{ rows: Entry[] }>(`/api/audit?${p}`);
    setExtra([...extra, ...r.rows]);
  };
  const rows = [...(data?.rows ?? []), ...extra];

  return (
    <div>
      <PageHeader title="Audit trail" description="Every action, alert, submission, verification and escalation, in order. Entries cannot be edited, and each one is chained to the one before it."
        action={<Button kind="primary" busy={verifying} onClick={runVerify}><ShieldCheck size={16} /> Verify audit chain</Button>} />
      <HelpBox id="audit">Press <b>Verify audit chain</b> to recompute every fingerprint from the first entry. If anyone changed or deleted a past entry in the database, the check shows exactly where the chain breaks.</HelpBox>
      {verify && (
        <div className={`sheet settle mb-5 flex items-start gap-3 border-l-4 px-4 py-3 ${verify.valid ? "border-l-olive" : "border-l-brand"}`} role="status">
          {verify.valid ? <ShieldCheck className="mt-0.5 text-olive-ink" /> : <ShieldAlert className="mt-0.5 text-brand" />}
          <div className="text-[14px]">
            <div className="font-semibold">{verify.valid ? `Chain intact: all ${verify.checked} entries verified.` : `Chain broken at entry #${verify.broken_at}.`}</div>
            <div className="text-ink-soft">{verify.valid ? <>Latest fingerprint <code className="text-[12px]">{verify.head?.slice(0, 24)}…</code></> : verify.reason}</div>
          </div>
        </div>
      )}
      <div className="sheet mb-4 flex flex-wrap items-center gap-3 p-3">
        <select className="input w-auto" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Action type">
          <option value="">All actions</option>{data?.action_groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <input className="input max-w-sm" placeholder="Search person, case reference or details" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <span className="ml-auto text-[13px] text-ink-soft">{data ? `${data.total} entries in total` : ""}</span>
      </div>
      {loading ? <PageSkeleton /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <Card pad={false} title="Entries" subtitle="Newest first. Click a row to see its details and fingerprints.">
          <Table minWidth={980}>
            <thead><tr><th className="num">#</th><th>When (simulated)</th><th>Who</th><th>What</th><th>Case</th><th>Fingerprint</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <Fragment key={e.id}>
                  <tr className={`row-link ${open === e.id ? "selected" : ""}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td className="num text-ink-soft">{e.id}</td>
                    <td className="whitespace-nowrap text-[13px]">{fmtDateTime(e.at)}</td>
                    <td className="max-w-[260px] text-[13px]"><span className="inline-flex items-start gap-1.5">{e.actor_id ? <User size={13} className="mt-0.5 shrink-0" /> : <Bot size={13} className="mt-0.5 shrink-0 text-ink-soft" />}{e.actor_label}</span></td>
                    <td>{ACTION_TEXT[e.action] ?? e.action}<div className="text-[12px] text-ink-soft">{e.action} · {e.entity_type} {e.entity_id}</div></td>
                    <td>{e.application_id ? <Link href={`/applications/${e.application_id}`} onClick={(ev) => ev.stopPropagation()} className="no-underline">{e.ref_no}</Link> : "–"}</td>
                    <td><code className="text-[12px] text-ink-soft" title={e.hash}><Link2 size={11} className="mr-1 inline" />{e.hash.slice(0, 10)}</code></td>
                  </tr>
                  {open === e.id && (
                    <tr><td colSpan={6} className="bg-paper-2/40">
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[12px]">{JSON.stringify(e.details, null, 2)}</pre>
                      <div className="mt-1 break-all text-[11.5px] text-ink-soft">previous: {e.prev_hash}<br />this: {e.hash}</div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          {data && rows.length < data.total && rows.length >= 100 && (
            <div className="border-t border-line/70 p-3 text-center"><Button small onClick={more}>Load older entries</Button></div>
          )}
        </Card>
      )}
      <NextStep href="/performance" label="performance and KPIs" />
    </div>
  );
}
