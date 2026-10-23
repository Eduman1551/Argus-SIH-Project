"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, CheckCheck, Mail, MessageSquare } from "lucide-react";
import { Button, Card, Empty, ErrorNote, HelpBox, NextStep, PageHeader, PageSkeleton, Stamp, Table, Tabs } from "@/components/ui";
import { act, api, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useApp } from "@/lib/store";

interface Note { id: number; kind: string; title: string; body: string; link: string | null; created_at: string; read_at: string | null }
interface Out { id: number; channel: string; address: string; subject: string; body: string; status: string; status_reason: string | null;
  created_at: string; updated_at: string; recipient: string }

const KIND: Record<string, React.ReactNode> = {
  escalation: <Stamp tone="escalated" level={null}>Escalation</Stamp>, overdue: <Stamp tone="overdue" />, reminder: <Stamp tone="soon">Reminder</Stamp>,
  task: <Stamp tone="info">Task</Stamp>, action: <Stamp tone="info">Action needed</Stamp>, update: <Stamp tone="neutral">Update</Stamp>,
};

function DeliveryStamp({ s }: { s: string }) {
  if (s === "delivered") return <Stamp tone="closed">Delivered</Stamp>;
  if (s === "failed") return <Stamp tone="overdue">Failed</Stamp>;
  if (s === "sent") return <Stamp tone="soon">Sent</Stamp>;
  return <Stamp tone="neutral">Queued</Stamp>;
}

export default function NotificationsPage() {
  const user = useApp((s) => s.user)!;
  const [tab, setTab] = useState("inbox");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const notes = useApi<{ rows: Note[]; unread: number }>(`/api/notifications${unreadOnly ? "?unread=true" : ""}`);
  const out = useApi<{ rows: Out[]; counts: { channel: string; status: string; n: number }[]; note: string }>(tab === "log" ? `/api/outbox${everyone ? "?everyone=true" : ""}` : null);

  const open = async (n: Note) => {
    if (!n.read_at) { await api(`/api/notifications/${n.id}/read`, { body: {} }).catch(() => undefined); useApp.getState().bumpVersion(); }
  };

  return (
    <div>
      <PageHeader crumbs={[{ label: "Notifications" }]} title="Notifications" description="Your alerts, and the email and SMS log."
        action={tab === "inbox" && (notes.data?.unread ?? 0) > 0 ? <Button onClick={() => act("/api/notifications/read-all", {}, "All marked as read.")}><CheckCheck size={15} /> Mark all read</Button> : undefined} />
      <HelpBox id="notifications">Each alert also appears in the email and SMS log. No real email or SMS is sent.</HelpBox>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "inbox", label: <span className="inline-flex items-center gap-1.5"><Bell size={14} /> Alerts ({notes.data?.unread ?? 0} unread)</span> },
        { id: "log", label: <span className="inline-flex items-center gap-1.5"><Mail size={14} /> Email and SMS log</span> }]} />

      {tab === "inbox" ? (
        notes.loading ? <PageSkeleton /> : notes.error ? <ErrorNote error={notes.error} onRetry={notes.reload} /> : (
          <Card pad={false} title={`${notes.data!.rows.length} notification(s)`} action={
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-[var(--brand)]" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>}>
            {notes.data!.rows.length ? (
              <ul className="divide-y divide-line">
                {notes.data!.rows.map((n) => (
                  <li key={n.id} className={`flex gap-3 px-4 py-3 ${n.read_at ? "" : "bg-brand-tint/40"}`}>
                    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-brand"}`} aria-label={n.read_at ? "Read" : "Unread"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {KIND[n.kind] ?? <Stamp tone="neutral">{n.kind}</Stamp>}
                        <span className="text-[13.5px] font-medium">{n.title}</span>
                      </div>
                      <p className="mt-0.5 text-[13.5px]">{n.body}</p>
                      <div className="mt-1 flex items-center gap-3 text-[12.5px] text-ink-soft">
                        <span className="mono text-[12px]">{fmtDateTime(n.created_at)}</span>
                        {n.link && <Link href={n.link} onClick={() => open(n)}>Open</Link>}
                        {!n.read_at && <button className="text-brand hover:underline" onClick={() => open(n)}>Mark read</button>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <Empty title="No notifications." />}
          </Card>
        )
      ) : (
        out.loading ? <PageSkeleton /> : out.error ? <ErrorNote error={out.error} onRetry={out.reload} /> : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {out.data!.counts.map((c) => (
                <span key={`${c.channel}${c.status}`} className="surface inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12.5px]">
                  {c.channel === "email" ? <Mail size={13} className="text-ink-soft" /> : <MessageSquare size={13} className="text-ink-soft" />}{c.channel === "email" ? "Email" : "SMS"} <DeliveryStamp s={c.status} /> <b className="mono font-semibold">{c.n}</b>
                </span>
              ))}
              {user.role === "official" && <label className="ml-auto flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-[var(--brand)]" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Show messages for everyone</label>}
            </div>
            <Card pad={false} title="Delivery log" subtitle={out.data!.note}>
              <Table minWidth={960}>
                <thead><tr><th>Channel</th><th>To</th><th>Message</th><th>Created</th><th>Status</th></tr></thead>
                <tbody>{out.data!.rows.map((o) => (
                  <tr key={o.id}>
                    <td>{o.channel === "email" ? <span className="inline-flex items-center gap-1"><Mail size={14} /> Email</span> : <span className="inline-flex items-center gap-1"><MessageSquare size={14} /> SMS</span>}</td>
                    <td className="text-[13px]">{o.recipient}<div className="text-ink-soft">{o.address}</div></td>
                    <td className="max-w-[420px] text-[13px]">{o.subject && <div className="font-medium">{o.subject}</div>}<div className="line-clamp-2 text-ink-soft">{o.body}</div></td>
                    <td className="mono whitespace-nowrap text-[12px]">{fmtDateTime(o.created_at)}</td>
                    <td><DeliveryStamp s={o.status} />{o.status_reason && <div className="mt-0.5 text-[11.5px] text-ink-soft">{o.status_reason}</div>}</td>
                  </tr>
                ))}</tbody>
              </Table>
            </Card>
          </>
        )
      )}
      <NextStep href="/guide" label="guide and demo" />
    </div>
  );
}
