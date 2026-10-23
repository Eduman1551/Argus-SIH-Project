"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertOctagon, CheckCircle2, ChevronDown, Info, Menu, Search, WifiOff, X } from "lucide-react";
import { Kbd } from "@/components/ui";
import { api } from "@/lib/api";
import { useApp, type ClockState, type SessionUser } from "@/lib/store";
import { ClockChip } from "./shell/ClockChip";
import { CommandPalette } from "./shell/CommandPalette";
import { Wordmark } from "./shell/Logo";
import { groupActive, isActive, navFor, type NavGroup } from "./shell/nav";
import { NotificationsButton } from "./shell/NotificationsPopover";
import { Popover } from "./shell/Popover";
import { scopeText, UserMenu, ROLE_TEXT } from "./shell/UserMenu";

const README = "https://github.com/Eduman1551/Argus-SIH-Project#readme";
/** Pages that work without a session; everything else sends you to /login. */
const PUBLIC = ["/login", "/welcome"];

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
      timer.current = setTimeout(poll, document.hidden ? 6000 : 3000);
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
  const [palette, setPalette] = useState(false);
  const poll = useLive();

  useEffect(() => {
    api<{ user: SessionUser | null }>("/api/session").then((r) => setSession(r.user)).catch(() => setSession(null));
  }, [setSession]);

  useEffect(() => {
    if (sessionLoaded && !user && !PUBLIC.includes(pathname)) router.replace("/login");
  }, [sessionLoaded, user, pathname, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (useApp.getState().user) setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const welcome = PUBLIC.includes(pathname);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <Navbar user={welcome ? null : user} onPalette={() => setPalette(true)} />
      <ConnectionBanners onRetry={poll} />
      <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-8 pt-6 sm:px-6">
        {welcome || user ? children : <div className="py-24 text-center text-ink-soft">Loading your workspace…</div>}
      </main>
      <Footer />
      {user && !welcome && <CommandPalette open={palette} onClose={() => setPalette(false)} user={user} />}
      <Toasts />
    </div>
  );
}

/* ================================================================ navbar */
function Navbar({ user, onPalette }: { user: SessionUser | null; onPalette: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setMobile(false), [pathname]);

  return (
    <div className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
      <nav aria-label="Main" className={`glass mx-auto flex h-14 max-w-[1280px] items-center gap-2 rounded-2xl px-2.5 transition-[background-color,box-shadow] duration-200 ${scrolled ? "glass-strong" : ""}`}>
        <Link href={user ? (user.role === "committee" ? "/my-cases" : "/") : "/login"} className="rounded-lg px-2 py-1 no-underline" aria-label="Argus home">
          <Wordmark />
        </Link>
        {user && <DesktopNav user={user} />}
        <div className="ml-auto flex items-center gap-1">
          {user && (
            <>
              <button onClick={onPalette} aria-label="Search (Ctrl K)"
                className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface/70 px-2.5 text-[13px] text-ink-soft hover:bg-surface hover:text-ink">
                <Search size={15} aria-hidden />
                <span className="hidden xl:inline">Search</span>
                <span className="hidden xl:inline-flex"><Kbd>Ctrl K</Kbd></span>
              </button>
              <ClockChip />
              <NotificationsButton />
              <UserMenu user={user} />
              <button onClick={() => setMobile(!mobile)} aria-label={mobile ? "Close menu" : "Open menu"} aria-expanded={mobile}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink hover:bg-surface lg:hidden">
                {mobile ? <X size={18} /> : <Menu size={18} />}
              </button>
            </>
          )}
        </div>
      </nav>
      <AnimatePresence>{user && mobile && <MobileSheet user={user} />}</AnimatePresence>
    </div>
  );
}

function DesktopNav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const groups = navFor(user);
  useEffect(() => setOpenGroup(null), [pathname]);

  return (
    <ul className="ml-2 hidden items-center gap-0.5 lg:flex">
      {groups.map((g) => {
        const active = groupActive(pathname, g);
        const indicator = active && (
          <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-brand-tint"
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }} />
        );
        const cls = `relative flex h-9 items-center gap-1 rounded-lg px-3 text-[13.5px] font-medium no-underline transition-colors ${active ? "text-brand-hover" : "text-ink-soft hover:text-ink"}`;
        if (g.href) {
          return (
            <li key={g.label}>
              <Link href={g.href} className={cls} aria-current={active ? "page" : undefined}>
                {indicator}<span className="relative">{g.label}</span>
              </Link>
            </li>
          );
        }
        const open = openGroup === g.label;
        return (
          <li key={g.label} className="relative">
            <button className={cls} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpenGroup(open ? null : g.label)}>
              {indicator}
              <span className="relative">{g.label}</span>
              <ChevronDown size={13} className={`relative transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>
            <GroupMenu group={g} open={open} onClose={() => setOpenGroup(null)} pathname={pathname} />
          </li>
        );
      })}
    </ul>
  );
}

function GroupMenu({ group, open, onClose, pathname }: { group: NavGroup; open: boolean; onClose: () => void; pathname: string }) {
  return (
    <Popover open={open} onClose={onClose} align="left" width={300} label={group.label}>
      <ul role="menu">
        {(group.items ?? []).map((it) => {
          const Icon = it.icon;
          const active = isActive(pathname, it.href);
          return (
            <li key={it.href} role="none">
              <Link role="menuitem" href={it.href} onClick={onClose}
                className={`flex items-start gap-3 rounded-lg px-3 py-2 no-underline ${active ? "bg-brand-tint" : "hover:bg-surface-2"}`}>
                <span className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-md ${active ? "bg-white text-brand" : "bg-surface-2 text-ink-soft"}`}><Icon size={15} /></span>
                <span className="min-w-0">
                  <span className={`block text-[13.5px] font-medium ${active ? "text-brand-hover" : "text-ink"}`}>{it.label}</span>
                  {it.hint && <span className="block text-[12px] text-ink-soft">{it.hint}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

function MobileSheet({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const groups = navFor(user);
  return (
    <motion.div initial={{ y: -8, opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.18 }}
      className="glass glass-strong mx-auto mt-2 max-w-[1280px] rounded-2xl p-2 lg:hidden">
      <div className="px-3 pb-2 pt-1 text-[12px] text-ink-soft">{user.name} · {ROLE_TEXT[user.role]} · {scopeText(user)}</div>
      {groups.map((g) => (
        <div key={g.label} className="border-t border-line py-1">
          {g.href ? (
            <Link href={g.href} className={`block rounded-lg px-3 py-2 text-[14px] font-medium no-underline ${isActive(pathname, g.href) ? "bg-brand-tint text-brand-hover" : "text-ink"}`}>{g.label}</Link>
          ) : (
            <>
              <div className="px-3 pb-0.5 pt-1.5 text-[11.5px] font-medium text-ink-soft">{g.label}</div>
              {g.items?.map((it) => (
                <Link key={it.href} href={it.href} className={`block rounded-lg px-3 py-2 text-[14px] no-underline ${isActive(pathname, it.href) ? "bg-brand-tint text-brand-hover" : "text-ink"}`}>{it.label}</Link>
              ))}
            </>
          )}
        </div>
      ))}
      <div className="flex gap-1 border-t border-line pt-1">
        <Link href="/notifications" className="rounded-lg px-3 py-2 text-[13.5px] text-ink no-underline">Notifications</Link>
        <Link href="/guide" className="rounded-lg px-3 py-2 text-[13.5px] text-ink no-underline">Guide</Link>
      </div>
    </motion.div>
  );
}

/* ================================================================ footer, banners, toasts */
function Footer() {
  return (
    <footer className="mt-6 border-t border-line">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-5 text-[12px] text-ink-soft sm:px-6">
        <span className="font-medium text-ink">Argus</span>
        <span>Prototype · all data is synthetic</span>
        <span className="ml-auto flex gap-4">
          <Link href="/guide" className="text-ink-soft no-underline hover:text-brand">Guide</Link>
          <a href={README} className="text-ink-soft no-underline hover:text-brand" target="_blank" rel="noreferrer">README</a>
        </span>
      </div>
    </footer>
  );
}

function ConnectionBanners({ onRetry }: { onRetry: () => void }) {
  const { connection, pending } = useApp();
  if (connection !== "offline" && pending === 0) return null;
  return (
    <div className="mx-auto mt-3 w-full max-w-[1280px] px-4 sm:px-6">
      {connection === "offline" ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-tint px-4 py-2.5 text-[13.5px] text-danger-ink" role="alert">
          <span className="flex items-center gap-2"><WifiOff size={16} /> Cannot reach the Argus server. Data on screen may be out of date.</span>
          <button onClick={onRetry} className="rounded-lg border border-danger/30 bg-surface px-2.5 py-1 text-[12.5px] font-medium text-danger-ink hover:bg-white">Retry</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn-tint px-4 py-2.5 text-[13.5px] text-warn-ink" role="status">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          Waking up the server. The first request after a quiet period can take a few seconds.
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[400px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ y: 8, opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.18 }}
            className="glass glass-strong pointer-events-auto flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13.5px]">
            {t.kind === "error" ? <AlertOctagon size={17} className="mt-0.5 shrink-0 text-danger" /> : t.kind === "success" ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-brand" /> : <Info size={17} className="mt-0.5 shrink-0 text-ink-soft" />}
            <span className="flex-1 text-ink">{t.text}</span>
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-ink-soft hover:text-ink"><X size={15} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
