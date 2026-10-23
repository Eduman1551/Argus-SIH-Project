"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Stamp } from "@/components/ui";
import { act, api } from "@/lib/api";
import { fmtShort } from "@/lib/format";
import { useApp } from "@/lib/store";
import { Popover } from "./Popover";

interface Note { id: number; kind: string; title: string; link: string | null; created_at: string; read_at: string | null }

const KIND_TONE: Record<string, [Parameters<typeof Stamp>[0]["tone"], string]> = {
  escalation: ["escalated", "Escalation"], overdue: ["overdue", "Overdue"], reminder: ["soon", "Reminder"],
  task: ["info", "Task"], action: ["info", "Action"], update: ["neutral", "Update"],
};

export function NotificationsButton() {
  const { unread, version } = useApp();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Note[] | null>(null);

  useEffect(() => {
    if (!open) return;
    api<{ rows: Note[] }>("/api/notifications").then((r) => setRows(r.rows.slice(0, 7))).catch(() => setRows([]));
  }, [open, version]);

  const read = async (n: Note) => {
    setOpen(false);
    if (!n.read_at) {
      await api(`/api/notifications/${n.id}/read`, { body: {} }).catch(() => undefined);
      useApp.getState().bumpVersion();
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Notifications, ${unread} unread`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink">
        <Bell size={18} />
        {unread > 0 && (
          <span className="mono absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10.5px] font-semibold leading-[18px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={360} label="Notifications">
        <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
          <span className="text-[13px] font-semibold">Notifications</span>
          {unread > 0 && (
            <button onClick={() => act("/api/notifications/read-all", {}, "All marked as read.")}
              className="flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"><CheckCheck size={13} /> Mark all read</button>
          )}
        </div>
        <ul className="max-h-[360px] overflow-y-auto scroll-thin">
          {!rows && <li className="px-3 py-6 text-center text-[12.5px] text-ink-soft">Loading…</li>}
          {rows?.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-ink-soft">Nothing yet.</li>}
          {rows?.map((n) => {
            const [tone, label] = KIND_TONE[n.kind] ?? ["neutral", n.kind];
            return (
              <li key={n.id}>
                <Link href={n.link ?? "/notifications"} onClick={() => read(n)}
                  className={`flex gap-2.5 rounded-lg px-3 py-2 text-ink no-underline hover:bg-surface-2 ${n.read_at ? "" : "bg-brand-tint/40"}`}>
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-brand"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] leading-snug">{n.title}</span>
                    <span className="mt-1 flex items-center gap-2 text-[11.5px] text-ink-soft"><Stamp tone={tone}>{label}</Stamp><span className="mono">{fmtShort(n.created_at)}</span></span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <Link href="/notifications" onClick={() => setOpen(false)} className="mt-1 block rounded-lg border-t border-line px-3 py-2 text-center text-[12.5px] font-medium no-underline hover:bg-surface-2">
          Open notification centre and delivery log
        </Link>
      </Popover>
    </div>
  );
}
