"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, Bot, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { Avatar, Button, Callout, Card, Drawer, ErrorNote, HelpBox, KeyVal, NextStep, PageHeader, PageSkeleton, Table, useRowNav } from "@/components/ui";
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
  const onOpen = useCallback((i: number) => setOpen((o) => { const id = [...(data?.rows ?? []), ...extra][i]?.id ?? null; return o === id ? null : id; }), [data, extra]);
  const rowProps = useRowNav((data?.rows.length ?? 0) + extra.length, onOpen);
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
  const sel = rows.find((e) => e.id === open);

  return (
    <div>
      <PageHeader crumbs={[{ label: "Insight" }, { label: "Audit trail" }]} title="Audit trail" description="Every action, alert, submission, verification and escalation, in order. Entries cannot be edited, and each one is chained to the one before it."
        action={<Button kind="primary" busy={verifying} onClick={runVerify}><ShieldCheck size={15} /> Verify audit chain</Button>} />
      <HelpBox id="audit">Press <b>Verify audit chain</b> to recompute every fingerprint from the first entry. If anyone changed or deleted a past entry in the database, the check shows exactly where the chain breaks.</HelpBox>
      {verify && (
        <div role="status" className={`enter mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${verify.valid ? "border-brand/25 bg-brand-tint" : "border-danger/30 bg-danger-tint"}`}>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${verify.valid ? "bg-brand" : "bg-danger"}`}>
            {verify.valid ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
          </span>
          <div className="text-[13.5px]">
            <div className="font-semibold">{verify.valid ? <>Chain intact: all <span className="mono">{verify.checked}</span> entries verified.</> : <>Chain broken at entry <span className="mono">#{verify.broken_at}</span>.</>}</div>
            <div className="text-ink-soft">{verify.valid ? <>Latest fingerprint <code className="mono text-[12px] text-ink">{verify.head?.slice(0, 24)}…</code></> : verify.reason}</div>
          </div>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input className="field pl-9" placeholder="Search person, case reference or details" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        <select className="field w-auto" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Action type">
          <option value="">All actions</option>{data?.action_groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="mono ml-auto text-[12.5px] text-ink-soft">{data ? `${data.total} entries` : ""}</span>
      </div>
      {loading ? <PageSkeleton /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <Card pad={false} title="Entries" subtitle="Newest first. Click a row to see its details and how it links to the entry before it.">
          <Table minWidth={980}>
            <thead><tr><th className="num">#</th><th>When (simulated)</th><th>Who</th><th>What</th><th>Case</th><th>Fingerprint</th></tr></thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id} {...rowProps(i)} className={`is-link ${open === e.id ? "is-active" : ""}`} aria-label={`Details of entry ${e.id}`}>
                  <td className="num mono text-ink-soft">{e.id}</td>
                  <td className="mono whitespace-nowrap text-[12.5px]">{fmtDateTime(e.at)}</td>
                  <td className="max-w-[280px] text-[13px]"><div className="flex min-w-0 items-center gap-2">{e.actor_id ? <Avatar name={e.actor_label} /> : <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-soft ring-1 ring-inset ring-line"><Bot size={12} /></span>}
                    <div className="min-w-0">{e.actor_id ? <><div className="truncate">{e.actor_label.split(" (")[0]}</div>{e.actor_label.includes(" (") && <div className="truncate text-[11.5px] text-ink-soft">{e.actor_label.slice(e.actor_label.indexOf(" (") + 2, -1)}</div>}</> : <div className="truncate">Argus automation</div>}</div></div></td>
                  <td>{ACTION_TEXT[e.action] ?? e.action}<div className="mono text-[11.5px] text-ink-soft">{e.action}</div></td>
                  <td>{e.application_id ? <Link href={`/applications/${e.application_id}`} onClick={(ev) => ev.stopPropagation()} className="mono no-underline">{e.ref_no}</Link> : <span className="text-ink-soft">–</span>}</td>
                  <td><code className="mono inline-flex h-[20px] items-center rounded-md bg-surface-2 px-1.5 text-[11px] text-ink-soft ring-1 ring-inset ring-line" title={e.hash}>{e.hash.slice(0, 8)}</code></td>
                </tr>
              ))}
            </tbody>
          </Table>
          {data && rows.length < data.total && rows.length >= 100 && (
            <div className="border-t border-line p-3 text-center"><Button small onClick={more}>Load older entries</Button></div>
          )}
        </Card>
      )}
      <Drawer open={!!sel} onClose={() => setOpen(null)} title={sel ? (ACTION_TEXT[sel.action] ?? sel.action) : ""}
        subtitle={sel ? <span className="mono">Entry #{sel.id} · {fmtDateTime(sel.at)}</span> : undefined}>
        {sel && (
          <div className="space-y-5">
            <KeyVal items={[
              ["Who", sel.actor_id ? sel.actor_label : "Argus automation"],
              ["Action", <span key="a" className="mono text-[12.5px]">{sel.action}</span>],
              ["Item", <span key="i" className="mono text-[12.5px]">{sel.entity_type} {sel.entity_id}</span>],
              ["Case", sel.application_id ? <Link key="c" href={`/applications/${sel.application_id}`} className="mono">{sel.ref_no}</Link> : "–"],
            ]} />
            <div>
              <div className="mb-2 text-[12.5px] font-medium text-ink-soft">Hash chain</div>
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="text-[11.5px] text-ink-soft">Previous entry</div>
                <code className="mono block break-all text-[11.5px]">{sel.prev_hash}</code>
                <ArrowDown size={14} className="my-1.5 text-brand" aria-hidden />
                <div className="text-[11.5px] text-ink-soft">This entry (hash of the previous hash plus this entry)</div>
                <code className="mono block break-all text-[11.5px] font-medium text-brand-hover">{sel.hash}</code>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[12.5px] font-medium text-ink-soft">Recorded details</div>
              <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-3 text-[11.5px]">{JSON.stringify(sel.details, null, 2)}</pre>
            </div>
            <Callout kind="note">Entries are append-only. Changing any past entry breaks every hash after it, which the Verify button detects.</Callout>
          </div>
        )}
      </Drawer>
      <NextStep href="/performance" label="performance and KPIs" />
    </div>
  );
}
