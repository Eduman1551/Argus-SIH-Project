"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity, AlertOctagon, BarChart3, Bell, BookOpen, Briefcase, CalendarClock, ChevronDown, ChevronsLeft, ChevronsRight,
  ClipboardCheck, FileClock, FileText, FolderOpen, Gauge, Home, Inbox, ListChecks, RotateCcw, ScrollText, Settings2,
  ShieldCheck, Users, Wifi, WifiOff, X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtWeekday } from "@/lib/format";
import { useApp, type ClockState, type Role, type SessionUser } from "@/lib/store";

interface NavItem { href: string; label: string; icon: ReactNode; bureau?: boolean }

const NAV: Record<Role, NavItem[]> = {
  institution: [
    { href: "/", label: "Home", icon: <Home size={18} /> },
    { href: "/applications", label: "My applications", icon: <FolderOpen size={18} /> },
    { href: "/undertakings", label: "Undertakings", icon: <ClipboardCheck size={18} /> },
    { href: "/documents", label: "Documents", icon: <FileClock size={18} /> },
  ],
  official: [
    { href: "/", label: "Dashboard", icon: <Gauge size={18} /> },
    { href: "/queue", label: "My queue", icon: <Inbox size={18} /> },
    { href: "/applications", label: "Applications", icon: <FolderOpen size={18} /> },
    { href: "/evc", label: "EVC board", icon: <CalendarClock size={18} /> },
    { href: "/compliance", label: "Compliance", icon: <ClipboardCheck size={18} /> },
    { href: "/validity", label: "Document validity", icon: <FileClock size={18} /> },
    { href: "/escalations", label: "Escalations", icon: <AlertOctagon size={18} /> },
    { href: "/reports", label: "Reports", icon: <FileText size={18} /> },
    { href: "/audit", label: "Audit trail", icon: <ShieldCheck size={18} /> },
    { href: "/settings/rules", label: "Rules and timelines", icon: <Settings2 size={18} />, bureau: true },
  ],
  committee: [
    { href: "/my-cases", label: "My cases", icon: <Briefcase size={18} /> },
  ],
};
const COMMON: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: <Bell size={18} /> },
  { href: "/performance", label: "Performance", icon: <BarChart3 size={18} /> },
  { href: "/guide", label: "Guide and demo", icon: <BookOpen size={18} /> },
];

const ROLE_TEXT: Record<Role, string> = { institution: "Institution", official: "Official", committee: "Committee" };

/* ================================================================ live polling */
function useLive() {
  const setLive = useApp((s) => s.setLive);
  const setConnection = useApp((s) => s.setConnection);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poll = useCallback(async () => {
    try {
      const r = await api<{ clock: ClockState; version: number; unread: number }>("/api/live");
      setLive(r.clock, r.version, r.unread);
    } catch {
      setConnection("offline");
    } finally {
      const next = document.hidden ? 6000 : 3000;
      timer.current = setTimeout(poll, next);
    }
  }, [setLive, setConnection]);
  useEffect(() => {
    void poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [poll]);
  return poll;
}

/* ================================================================ shell */
export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, sessionLoaded, setSession } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const poll = useLive();

  useEffect(() => {
    api<{ user: SessionUser | null }>("/api/session").then((r) => setSession(r.user)).catch(() => setSession(null));
  }, [setSession]);

  useEffect(() => {
    if (sessionLoaded && !user && pathname !== "/welcome") router.replace("/welcome");
  }, [sessionLoaded, user, pathname, router]);

  useEffect(() => {
    const saved = localStorage.getItem("argus.sidebar");
    const narrow = window.innerWidth < 1280;
    setCollapsed(saved ? saved === "collapsed" : narrow);
    const onResize = () => { if (window.innerWidth < 1280 && !localStorage.getItem("argus.sidebar")) setCollapsed(true); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("argus.sidebar", next ? "collapsed" : "open");
  };

  if (pathname === "/welcome") {
    return <><Banner /><main className="mx-auto max-w-6xl px-6 py-8">{children}</main><Toasts /></>;
  }

  const items = user ? [...NAV[user.role].filter((i) => !i.bureau || user.is_bureau), ...COMMON] : [];

  return (
    <div className="min-h-screen">
      <Banner />
      <div className="flex">
        <aside className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-paper-2/80 transition-[width] duration-200 ${collapsed ? "w-[64px]" : "w-[236px]"}`}>
          <Link href="/" className="flex items-center gap-2.5 border-b border-line px-3.5 py-3.5 no-underline" title="Argus home">
            <Logo />
            {!collapsed && (
              <span className="leading-tight">
                <span className="block font-serif text-[20px] font-bold tracking-wide text-brand-deep">Argus</span>
                <span className="block text-[10.5px] uppercase tracking-[0.14em] text-ink-soft">Approval watch</span>
              </span>
            )}
          </Link>
          <nav className="scroll-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
            {items.map((item, i) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const sep = i === items.length - COMMON.length;
              return (
                <div key={item.href}>
                  {sep && <div className="mx-2 my-2 border-t border-line/80" />}
                  <Link href={item.href} title={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined}
                    className={`group mb-0.5 flex items-center gap-3 rounded-md px-2.5 py-2 text-[14px] no-underline transition-colors ${active ? "bg-brand text-white shadow-sm" : "text-ink hover:bg-card"}`}>
                    <span className={active ? "text-white" : "text-ink-soft group-hover:text-brand"}>{item.icon}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                </div>
              );
            })}
          </nav>
          <button onClick={toggle} className="flex items-center gap-2 border-t border-line px-4 py-3 text-[13px] text-ink-soft hover:text-brand" aria-label={collapsed ? "Expand menu" : "Collapse menu"}>
            {collapsed ? <ChevronsRight size={18} /> : <><ChevronsLeft size={18} /> Collapse</>}
          </button>
        </aside>
        <div className="min-w-0 flex-1">
          <TopBar onRetry={poll} />
          <ConnectionBanners onRetry={poll} />
          <main className="mx-auto max-w-[1440px] px-6 py-6">
            {!user ? <div className="py-20 text-center text-ink-soft">Loading your workspace…</div> : children}
          </main>
          <footer className="mx-auto max-w-[1440px] px-6 pb-6 text-[12px] text-ink-soft">
            Argus is decision support and workflow automation only. It never approves, rejects, grants or denies.
            Statutory scrutiny, inspection and decisions stay with the competent human authority.
          </footer>
        </div>
      </div>
      <Toasts />
    </div>
  );
}

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden className="shrink-0">
      <circle cx="17" cy="17" r="16" fill="#B3262D" />
      <circle cx="17" cy="17" r="12.5" fill="none" stroke="#FBF6EC" strokeWidth="1" strokeDasharray="2 2.2" />
      <path d="M6 17c3.2-5 7-7.5 11-7.5S24.8 12 28 17c-3.2 5-7 7.5-11 7.5S9.2 22 6 17z" fill="#FBF6EC" />
      <circle cx="17" cy="17" r="4.4" fill="#7E1B22" />
      <circle cx="18.4" cy="15.6" r="1.2" fill="#FBF6EC" />
    </svg>
  );
}

function Banner() {
  return (
    <div className="bg-brand-deep px-4 py-1 text-center text-[12px] font-medium tracking-wide text-white">
      <span className="font-bold">SYNTHETIC DATA</span> · Prototype, not an official AICTE system · Rules shown are illustrative, not official APH figures
    </div>
  );
}

/* ================================================================ top bar */
function TopBar({ onRetry }: { onRetry: () => void }) {
  const { user, clock, unread, connection, toast, bumpVersion } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const advance = async (days: number) => {
    setBusy(`+${days}`);
    try {
      const r = await api<{ alerts: number; escalations: number; to: string }>("/api/clock/advance", { body: { days } });
      toast("success", `Clock moved to ${fmtDate(r.to)}. ${r.alerts} alert(s) fired, ${r.escalations} escalation(s).`);
      bumpVersion();
      await onRetry();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    setBusy("reset");
    try {
      await api("/api/demo/reset", { body: {} });
      toast("success", "Demo data and clock restored to the seeded state.");
      bumpVersion();
      await onRetry();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
      setConfirmReset(false);
    }
  };

  return (
    <div className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5">
        <div className="flex items-center gap-2 rounded-md border border-line bg-card px-2.5 py-1.5" title="Simulated platform clock. All deadlines use this date.">
          <CalendarClock size={17} className="text-brand" aria-hidden />
          <div className="leading-tight">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">Simulated date</div>
            <div className="text-[14px] font-semibold tabular-nums">{clock ? `${fmtWeekday(clock.today).slice(0, 3)}, ${fmtDate(clock.today)}` : "…"}</div>
          </div>
          <div className="ml-1.5 flex items-center gap-1">
            {[1, 7, 30].map((d) => (
              <button key={d} onClick={() => advance(d)} disabled={!!busy || !user}
                className="rounded border border-line bg-paper px-2 py-0.5 text-[12.5px] font-semibold text-ink hover:border-brand hover:text-brand disabled:opacity-50"
                aria-label={`Advance the clock by ${d} day${d > 1 ? "s" : ""}`}>
                {busy === `+${d}` ? "…" : `+${d}d`}
              </button>
            ))}
            <button onClick={() => setConfirmReset(true)} disabled={!!busy || !user} title="Reset demo data and clock"
              className="rounded border border-line bg-paper px-1.5 py-0.5 text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50" aria-label="Reset demo">
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1" />

        <ConnectionDot connection={connection} />

        <Link href="/notifications" className="relative rounded-md p-2 text-ink hover:bg-paper-2" aria-label={`Notifications, ${unread} unread`}>
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[19px] rounded-full bg-brand px-1 text-center text-[11px] font-bold leading-[19px] text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>

        {user && <RoleSwitcher user={user} />}
      </div>

      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/35 p-4 pt-[14vh]" role="dialog" aria-modal="true">
          <div className="sheet settle w-full max-w-md p-5">
            <h2 className="text-lg font-semibold">Reset the demo?</h2>
            <p className="mt-1 text-[14px] text-ink-soft">This restores the seeded synthetic data and puts the simulated clock back to {clock ? fmtDate(clock.seed_today) : "the seed date"}. Everything done since is discarded.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-md border border-line bg-card px-3.5 py-2 text-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="rounded-md border border-brand bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-deep" onClick={reset} disabled={busy === "reset"}>
                {busy === "reset" ? "Resetting…" : "Reset demo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionDot({ connection }: { connection: string }) {
  const map: Record<string, [string, string, ReactNode]> = {
    live: ["Live", "text-olive-ink", <Wifi key="w" size={15} />],
    connecting: ["Connecting", "text-ink-soft", <Activity key="a" size={15} />],
    waking: ["Waking up", "text-ochre-ink", <Activity key="a" size={15} />],
    offline: ["Offline", "text-brand", <WifiOff key="o" size={15} />],
  };
  const [label, cls, icon] = map[connection] ?? map.connecting;
  return (
    <span className={`hidden items-center gap-1.5 text-[12.5px] font-medium sm:inline-flex ${cls}`} title="Updates are fetched every few seconds">
      {icon}{label}
    </span>
  );
}

interface DemoUser { id: number; code: string; name: string; role: Role; designation: string; featured: boolean; institution: string | null; region: string | null }

function RoleSwitcher({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const { setSession, bumpVersion, toast } = useApp();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || users.length) return;
    api<{ users: DemoUser[] }>("/api/users/demo").then((r) => setUsers(r.users)).catch(() => undefined);
  }, [open, users.length]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = async (id: number) => {
    try {
      await api("/api/session", { body: { user_id: id } });
      const r = await api<{ user: SessionUser }>("/api/session");
      setSession(r.user);
      bumpVersion();
      setOpen(false);
      toast("info", `You are now ${r.user.name} (${ROLE_TEXT[r.user.role]}).`);
      router.push(r.user.role === "committee" ? "/my-cases" : "/");
    } catch (e) {
      toast("error", (e as ApiError).message);
    }
  };

  const featured = users.filter((u) => u.featured);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-md border border-line bg-card px-2.5 py-1.5 text-left hover:border-brand/50" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-tint font-serif text-[13px] font-bold text-brand-deep">
          {user.name.replace(/^(Dr\.|Prof\.)\s*/, "").split(" ").map((p) => p[0]).slice(0, 2).join("")}
        </span>
        <span className="hidden leading-tight md:block">
          <span className="block max-w-[200px] truncate text-[13.5px] font-semibold">{user.name}</span>
          <span className="block max-w-[200px] truncate text-[11.5px] text-ink-soft">{ROLE_TEXT[user.role]} · {user.institution_name ?? user.region_name ?? (user.is_bureau ? "Approval Bureau" : user.committee_kind ?? "")}</span>
        </span>
        <ChevronDown size={16} className="text-ink-soft" />
      </button>
      {open && (
        <div className="sheet settle absolute right-0 z-40 mt-1.5 w-[330px] p-2" role="menu">
          <div className="px-2 pb-1.5 pt-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink-soft">Switch demo user</div>
          {!users.length && <div className="px-2 py-3 text-sm text-ink-soft">Loading…</div>}
          {featured.map((u) => (
            <button key={u.id} role="menuitem" onClick={() => pick(u.id)}
              className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-paper-2 ${u.id === user.id ? "bg-brand-tint" : ""}`}>
              <Users size={15} className="mt-0.5 shrink-0 text-ink-soft" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold">{u.name}</span>
                <span className="block truncate text-[12px] text-ink-soft">{ROLE_TEXT[u.role]} · {u.designation}</span>
              </span>
            </button>
          ))}
          <Link href="/welcome" onClick={() => setOpen(false)} className="mt-1 block rounded-md px-2 py-1.5 text-[13px] font-medium">
            All {users.length || ""} demo users…
          </Link>
          <div className="border-t border-line/70 px-2 pt-1.5 text-[11.5px] text-ink-soft">Demo sign-in only. Real login is future scope.</div>
        </div>
      )}
    </div>
  );
}

/* ================================================================ banners and toasts */
function ConnectionBanners({ onRetry }: { onRetry: () => void }) {
  const { connection, pending } = useApp();
  if (connection === "offline") {
    return (
      <div className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-md border border-brand/50 bg-brand-tint px-4 py-2 text-[14px] text-brand-deep" role="alert">
        <span className="flex items-center gap-2"><WifiOff size={16} /> Cannot reach the Argus server. Data on screen may be out of date.</span>
        <button onClick={onRetry} className="rounded border border-brand bg-card px-2.5 py-1 text-[13px] font-medium text-brand hover:bg-brand hover:text-white">Retry</button>
      </div>
    );
  }
  if (pending > 0) {
    return (
      <div className="mx-6 mt-3 flex items-center gap-2 rounded-md border border-ochre/50 bg-ochre-tint px-4 py-2 text-[14px] text-ochre-ink" role="status">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
        Waking up the server. The first request after a quiet period can take a few seconds.
      </div>
    );
  }
  return null;
}

function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`sheet settle pointer-events-auto flex items-start gap-2 border-l-4 px-3.5 py-2.5 text-[14px] ${t.kind === "error" ? "border-l-brand" : t.kind === "success" ? "border-l-olive" : "border-l-ochre"}`}>
          {t.kind === "error" ? <AlertOctagon size={17} className="mt-0.5 shrink-0 text-brand" /> : t.kind === "success" ? <ListChecks size={17} className="mt-0.5 shrink-0 text-olive-ink" /> : <ScrollText size={17} className="mt-0.5 shrink-0 text-ochre-ink" />}
          <span className="flex-1">{t.text}</span>
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-ink-soft hover:text-ink"><X size={15} /></button>
        </div>
      ))}
    </div>
  );
}
