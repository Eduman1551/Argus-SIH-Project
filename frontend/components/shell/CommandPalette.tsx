"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CalendarPlus, CornerDownLeft, FolderOpen, Search, UserRound } from "lucide-react";
import { Kbd } from "@/components/ui";
import { advanceClock, demoUsers, switchUser, type DemoUser } from "@/lib/actions";
import { api } from "@/lib/api";
import { useApp, type SessionUser } from "@/lib/store";
import { pagesFor } from "./nav";
import { homeFor, ROLE_TEXT } from "./UserMenu";

interface Item { id: string; group: "Pages" | "Cases" | "Actions"; label: string; hint?: string; icon: ReactNode; run: () => void }
interface CaseHit { id: number; ref_no: string; institution: string; stage_name?: string; href: string }

async function findCases(user: SessionUser, q: string): Promise<CaseHit[]> {
  if (user.role === "committee") {
    const d = await api<{ visits: { id: number; application_id: number; ref_no: string; institution: string; step: string }[];
      reviews: { application_id: number; ref_no: string; institution: string }[] }>("/api/dashboard");
    const all: CaseHit[] = [
      ...d.visits.map((v) => ({ id: v.application_id, ref_no: v.ref_no, institution: v.institution, stage_name: v.step, href: `/visits/${v.id}` })),
      ...d.reviews.map((r) => ({ id: r.application_id, ref_no: r.ref_no, institution: r.institution, stage_name: "SAC/SHC review", href: `/cases/${r.application_id}` })),
    ];
    const s = q.toLowerCase();
    return all.filter((c) => c.ref_no.toLowerCase().includes(s) || c.institution.toLowerCase().includes(s)).slice(0, 6);
  }
  const r = await api<{ rows: { id: number; ref_no: string; institution: string; stage_name: string }[] }>(`/api/applications?q=${encodeURIComponent(q)}`);
  return r.rows.slice(0, 6).map((c) => ({ ...c, href: `/applications/${c.id}` }));
}

export function CommandPalette({ open, onClose, user }: { open: boolean; onClose: () => void; user: SessionUser }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cases, setCases] = useState<CaseHit[]>([]);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    setTimeout(() => input.current?.focus(), 10);
    demoUsers().then(setUsers).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setCases([]); return; }
    const t = setTimeout(() => findCases(user, q.trim()).then(setCases).catch(() => setCases([])), 180);
    return () => clearTimeout(t);
  }, [q, open, user]);

  const go = (href: string) => { onClose(); router.push(href); };

  const items = useMemo<Item[]>(() => {
    const s = q.trim().toLowerCase();
    const match = (t: string) => !s || t.toLowerCase().includes(s);
    const pages: Item[] = pagesFor(user).filter((p) => match(`${p.label} ${p.hint ?? ""}`)).map((p) => {
      const Icon = p.icon;
      return { id: `p:${p.href}`, group: "Pages", label: p.label, hint: p.hint, icon: <Icon size={15} />, run: () => go(p.href) };
    });
    const caseItems: Item[] = cases.map((c) => ({
      id: `c:${c.id}:${c.href}`, group: "Cases", label: c.ref_no, hint: `${c.institution}${c.stage_name ? ` · ${c.stage_name}` : ""}`,
      icon: <FolderOpen size={15} />, run: () => go(c.href),
    }));
    const actions: Item[] = [
      ...[1, 7, 30].map((d) => ({
        id: `a:+${d}`, group: "Actions" as const, label: `Advance clock +${d} day${d > 1 ? "s" : ""}`, hint: "Fires every reminder and escalation that falls due",
        icon: <CalendarPlus size={15} />, run: () => { onClose(); void advanceClock(d); },
      })),
      ...users.filter((u) => u.featured && u.id !== user.id).map((u) => ({
        id: `a:u${u.id}`, group: "Actions" as const, label: `Switch role: ${u.name}`, hint: `${ROLE_TEXT[u.role]} · ${u.designation}`,
        icon: <UserRound size={15} />, run: async () => { onClose(); const nu = await switchUser(u.id); if (nu) router.push(homeFor(nu.role)); },
      })),
    ].filter((a) => match(`${a.label} ${a.hint}`));
    return [...pages, ...caseItems, ...actions];
  }, [q, cases, users, user]); // go/onClose/router are stable enough for a palette that rebuilds on every keystroke

  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, items.length - 1))); }, [items.length]);
  useEffect(() => { list.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let index = -1;
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/20 px-4 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div role="dialog" aria-modal="true" aria-label="Search or jump to"
            initial={{ y: -6, opacity: 0.6, scale: 0.985 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -6, opacity: 0 }}
            transition={{ duration: 0.16 }} className="glass glass-strong w-full max-w-[600px] overflow-hidden rounded-2xl" onKeyDown={onKey}>
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={17} className="text-ink-soft" aria-hidden />
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }}
                placeholder="Search pages, cases by ID or institution, or actions"
                className="h-12 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-soft focus-visible:shadow-none"
                role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[sel] ? `pal-${sel}` : undefined} />
              <Kbd>Esc</Kbd>
            </div>
            <ul id="palette-list" ref={list} role="listbox" className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
              {!items.length && <li className="px-3 py-8 text-center text-[13px] text-ink-soft">No matches. Try a case reference such as ARG/2026/NR/0055.</li>}
              {(["Pages", "Cases", "Actions"] as const).map((g) => {
                const groupItems = items.filter((i) => i.group === g);
                if (!groupItems.length) return null;
                return (
                  <li key={g} role="presentation">
                    <div className="px-3 pb-1 pt-2 text-[11.5px] font-medium text-ink-soft">{g}</div>
                    <ul role="presentation">
                      {groupItems.map((it) => {
                        index += 1;
                        const i = index;
                        const active = i === sel;
                        return (
                          <li key={it.id} id={`pal-${i}`} data-index={i} role="option" aria-selected={active}
                            onMouseMove={() => setSel(i)} onClick={() => it.run()}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${active ? "bg-brand-tint" : ""}`}>
                            <span className={active ? "text-brand" : "text-ink-soft"}>{it.icon}</span>
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-[13.5px] ${it.group === "Cases" ? "mono" : ""} ${active ? "text-brand-hover" : "text-ink"}`}>{it.label}</span>
                              {it.hint && <span className="block truncate text-[12px] text-ink-soft">{it.hint}</span>}
                            </span>
                            {active ? <CornerDownLeft size={14} className="text-brand" aria-hidden /> : <ArrowRight size={14} className="text-line-strong" aria-hidden />}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-3 border-t border-line bg-surface-2/70 px-4 py-2 text-[11.5px] text-ink-soft">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
              <span className="flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
              <span className="ml-auto">Cases are searched as you type</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
