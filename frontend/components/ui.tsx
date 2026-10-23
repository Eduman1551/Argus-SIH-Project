"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, CircleAlert, Flag, Hourglass, Info, Lightbulb, X,
} from "lucide-react";
import { dueText } from "@/lib/format";

/* ================================================================ page structure */
export interface Crumb { label: string; href?: string }

export function PageHeader({ title, description, action, kicker, crumbs }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; kicker?: string; crumbs?: Crumb[];
}) {
  return (
    <header className="header-wash -mx-4 mb-6 rounded-2xl px-4 pb-5 pt-4 sm:-mx-6 sm:px-6">
      {(crumbs || kicker) && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-soft">
          {(crumbs ?? [{ label: kicker! }]).map((c, i, all) => (
            <Fragment key={`${c.label}${i}`}>
              {c.href ? <Link href={c.href} className="text-ink-soft no-underline hover:text-brand">{c.label}</Link> : <span>{c.label}</span>}
              {i < all.length - 1 && <ChevronRight size={12} className="text-muted" aria-hidden />}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">{title}</h1>
          {description && <p className="mt-1.5 max-w-3xl text-[14.5px] text-ink-soft">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}

export function Card({ title, subtitle, children, className = "", action, pad = true, id }: {
  title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; action?: ReactNode; pad?: boolean; id?: string;
}) {
  return (
    <section id={id} className={`surface enter scroll-mt-28 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15.5px] font-semibold leading-snug">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-soft">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/** A titled region without a box: hairline rule above, for documentation-style pages. */
export function Section({ id, title, description, children, action }: {
  id?: string; title: ReactNode; description?: ReactNode; children: ReactNode; action?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-line pt-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{title}</h2>
          {description && <p className="mt-0.5 text-[13.5px] text-ink-soft">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Grid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 }) {
  const c = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 xl:grid-cols-4", 5: "md:grid-cols-3 xl:grid-cols-5" }[cols];
  return <div className={`grid grid-cols-1 gap-4 ${c}`}>{children}</div>;
}

/* ================================================================ buttons */
type BtnKind = "primary" | "secondary" | "ghost" | "danger";
const BTN: Record<BtnKind, string> = {
  primary: "bg-brand text-white border border-brand hover:bg-brand-hover hover:border-brand-hover shadow-sm",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "text-brand border border-transparent hover:bg-brand-tint",
  danger: "bg-surface text-danger-ink border border-danger/40 hover:bg-danger-tint",
};

export function Button({ children, kind = "secondary", onClick, disabled, type = "button", small, title, busy }: {
  children: ReactNode; kind?: BtnKind; onClick?: () => void; disabled?: boolean; type?: "button" | "submit";
  small?: boolean; title?: string; busy?: boolean;
}) {
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${small ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]"} ${BTN[kind]}`}>
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, kind = "secondary", small }: {
  href: string; children: ReactNode; kind?: BtnKind; small?: boolean;
}) {
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg font-medium no-underline transition-colors duration-150 ${small ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]"} ${BTN[kind]} ${kind === "primary" ? "hover:text-white" : ""}`}>
      {children}
    </Link>
  );
}

/* ================================================================ status pills */
export type Tone = "ok" | "soon" | "overdue" | "escalated" | "closed" | "neutral" | "info" | "waiting";

const PILL: Record<Tone, string> = {
  ok: "bg-brand-tint text-brand",
  closed: "bg-brand-tint text-brand",
  info: "bg-brand-tint text-brand",
  soon: "bg-warn-tint text-warn-ink",
  overdue: "bg-danger-tint text-danger-ink",
  escalated: "bg-esc-tint text-esc",
  neutral: "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line",
  waiting: "bg-surface-2 text-ink-soft ring-1 ring-inset ring-line",
};
const DOT: Partial<Record<Tone, string>> = { ok: "bg-brand", info: "bg-brand", soon: "bg-warn", overdue: "bg-danger", neutral: "bg-muted" };

/** Status pill: always a dot or icon plus a text label. `solid` is for OVERDUE in tables only. */
export function Stamp({ tone, children, level, solid }: { tone: Tone; children?: ReactNode; level?: number | null; solid?: boolean }) {
  const label = children ?? (tone === "overdue" ? "Overdue" : tone === "escalated" ? `Escalated L${level}` : null);
  const icon = tone === "escalated" ? <Flag size={11} aria-hidden />
    : tone === "closed" ? <Check size={12} aria-hidden />
    : tone === "waiting" ? <Hourglass size={11} aria-hidden />
    : tone === "overdue" && solid ? <AlertTriangle size={11} aria-hidden />
    : <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone] ?? "bg-muted"}`} aria-hidden />;
  const cls = solid && tone === "overdue" ? "bg-danger text-white" : PILL[tone];
  return (
    <span className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium ${cls}`}
      title={tone === "escalated" && level ? `Escalated to level ${level}` : undefined}>
      {icon}{label}
    </span>
  );
}
export const Pill = Stamp;

export function SlaStamp({ status, days, level, waitingOn, solid }: {
  status?: string | null; days?: number | null; level?: number | null; waitingOn?: string | null; solid?: boolean;
}) {
  if (level) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {status === "overdue" && <Stamp tone="overdue" solid={solid}>Overdue{days != null ? ` ${-days}d` : ""}</Stamp>}
        <Stamp tone="escalated" level={level}>L{level}</Stamp>
      </span>
    );
  }
  if (status === "overdue") return <Stamp tone="overdue" solid={solid}>Overdue{days != null ? ` ${-days}d` : ""}</Stamp>;
  if (status === "due_soon") return <Stamp tone="soon">Due soon</Stamp>;
  if (status === "decided") return <Stamp tone="closed">Decided</Stamp>;
  if (waitingOn === "institution") return <Stamp tone="waiting">Waiting</Stamp>;
  return <Stamp tone="ok">On track</Stamp>;
}

export function DueCell({ date, days, fmt }: { date?: string | null; days?: number | null; fmt: (d?: string | null) => string }) {
  if (!date) return <span className="text-ink-soft">–</span>;
  const late = days != null && days < 0;
  return (
    <span className="whitespace-nowrap">
      <span className="mono text-[13px]">{fmt(date)}</span>
      {days != null && <span className={`block text-[12px] ${late ? "font-medium text-danger-ink" : days <= 3 ? "text-warn-ink" : "text-ink-soft"}`}>{dueText(days)}</span>}
    </span>
  );
}

/* ================================================================ numbers */
export function CountUp({ value, duration = 600 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (reduce) { setShown(value); return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduce]);
  return <>{shown}</>;
}

/** A metric inside a <Metrics> strip (one surface with hairline dividers, not a grid of cards). */
export function Stat({ label, value, hint, tone, href }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "warn" | "good" | "ink"; href?: string;
}) {
  const color = { red: "text-danger-ink", warn: "text-warn-ink", good: "text-brand", ink: "text-ink" }[tone ?? "ink"];
  const body = (
    <div className="h-full px-4 py-3">
      <div className="text-[12px] font-medium text-ink-soft">{label}</div>
      <div className={`mono mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em] ${color}`}>
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </div>
      {hint && <div className="mt-1.5 text-[12px] text-ink-soft">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full text-ink no-underline transition-colors hover:bg-surface-2">{body}</Link> : body;
}
export const Metric = Stat;

export function Metrics({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`surface enter mb-6 grid grid-cols-2 divide-line overflow-hidden sm:grid-cols-none sm:auto-cols-fr sm:grid-flow-col sm:divide-x [&>*]:border-line max-sm:[&>*:nth-child(odd)]:border-r max-sm:[&>*:nth-child(n+3)]:border-t ${className}`}>
      {children}
    </div>
  );
}

/* ================================================================ callouts */
type CalloutKind = "note" | "tip" | "warning";
const CALLOUT: Record<CalloutKind, [string, ReactNode, string]> = {
  note: ["border-line bg-surface-2", <Info key="n" size={16} className="text-ink-soft" />, "Note"],
  tip: ["border-brand/20 bg-brand-tint/60", <Lightbulb key="t" size={16} className="text-brand" />, "Tip"],
  warning: ["border-warn/30 bg-warn-tint/70", <CircleAlert key="w" size={16} className="text-warn-ink" />, "Warning"],
};

export function Callout({ kind = "note", title, children, onClose }: {
  kind?: CalloutKind; title?: ReactNode; children: ReactNode; onClose?: () => void;
}) {
  const [cls, icon, label] = CALLOUT[kind];
  return (
    <div className={`enter mb-5 flex gap-3 rounded-xl border px-4 py-3 text-[13.5px] ${cls}`} role="note">
      <span className="mt-0.5 shrink-0" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[12.5px] font-semibold text-ink">{title ?? label}</div>
        <div className="text-ink">{children}</div>
      </div>
      {onClose && (
        <button aria-label="Hide this note" onClick={onClose} className="self-start rounded-md p-1 text-ink-soft hover:bg-white/70 hover:text-ink">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/** "What to do here": a dismissible tip, remembered per page in localStorage. */
export function HelpBox({ id, children }: { id: string; children: ReactNode }) {
  const key = `argus.help.${id}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(localStorage.getItem(key) !== "hidden"); } catch { setOpen(true); }
  }, [key]);
  if (!open) {
    return (
      <button className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand hover:underline"
        onClick={() => { try { localStorage.removeItem(key); } catch { /* ignore */ } setOpen(true); }}>
        <Lightbulb size={13} /> What to do here
      </button>
    );
  }
  return (
    <Callout kind="tip" title="What to do here" onClose={() => { try { localStorage.setItem(key, "hidden"); } catch { /* ignore */ } setOpen(false); }}>
      {children}
    </Callout>
  );
}

export function NextStep({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-10 flex justify-end border-t border-line pt-4">
      <Link href={href} className="group inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium text-ink no-underline hover:bg-surface hover:text-brand">
        <span className="text-ink-soft group-hover:text-brand">Next</span> {label}
        <ArrowRight size={15} className="transition-transform duration-150 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

/* ================================================================ empty, loading, error */
function EmptyArt() {
  return (
    <svg width="64" height="48" viewBox="0 0 64 48" aria-hidden className="text-line-strong">
      <rect x="6" y="10" width="34" height="28" rx="4" fill="none" stroke="currentColor" />
      <rect x="22" y="4" width="36" height="28" rx="4" fill="var(--surface)" stroke="currentColor" />
      <path d="M30 14h20M30 20h14M30 26h17" stroke="var(--brand)" strokeOpacity=".45" strokeLinecap="round" />
      <circle cx="14" cy="32" r="3" fill="var(--brand)" fillOpacity=".25" />
    </svg>
  );
}

export function Empty({ title, children, icon, action }: { title: string; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-9 text-center">
      <div className="mb-1">{icon ?? <EmptyArt />}</div>
      <div className="text-[14.5px] font-semibold text-ink">{title}</div>
      {children && <div className="max-w-md text-[13px] text-ink-soft">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", className = "" }: { h?: number; w?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h, width: w }} />;
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton h={14} w={180} className="mb-3" />
      <Skeleton h={30} w={340} className="mb-2" />
      <Skeleton h={16} w={520} className="mb-7" />
      <Skeleton h={84} className="mb-5" />
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]"><Skeleton h={260} /><Skeleton h={260} /></div>
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: { message: string; status?: number }; onRetry?: () => void }) {
  return (
    <div className="surface flex items-center justify-between gap-3 border-danger/30 px-4 py-3 text-[13.5px]" role="alert">
      <span className="flex items-center gap-2 text-danger-ink"><AlertTriangle size={16} />{error.message}</span>
      {onRetry && <Button small onClick={onRetry}>Retry</Button>}
    </div>
  );
}

/* ================================================================ tables */
export function Table({ children, minWidth, maxHeight }: { children: ReactNode; minWidth?: number; maxHeight?: number }) {
  return (
    <div className="scroll-thin overflow-x-auto" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className="data-table" style={minWidth ? { minWidth } : undefined}>{children}</table>
    </div>
  );
}

/**
 * Keyboard navigation for clickable table rows: arrow keys move between rows, Enter opens.
 * Spread `rowProps(i)` on each <tr>.
 */
export function useRowNav(count: number, onOpen: (i: number) => void) {
  const refs = useRef<(HTMLTableRowElement | null)[]>([]);
  const rowProps = useCallback((i: number) => ({
    ref: (el: HTMLTableRowElement | null) => { refs.current[i] = el; },
    tabIndex: 0,
    className: "is-link",
    onClick: () => onOpen(i),
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === "ArrowDown") { e.preventDefault(); refs.current[Math.min(count - 1, i + 1)]?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); refs.current[Math.max(0, i - 1)]?.focus(); }
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(i); }
    },
  }), [count, onOpen]);
  return rowProps;
}

export interface Chip { key: string; label: ReactNode; onRemove: () => void }

export function FilterChips({ chips, onClear }: { chips: Chip[]; onClear?: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex h-7 items-center gap-1 rounded-full border border-brand/25 bg-brand-tint pl-2.5 pr-1 text-[12.5px] text-brand">
          {c.label}
          <button onClick={c.onRemove} aria-label={`Remove filter ${typeof c.label === "string" ? c.label : ""}`} className="rounded-full p-0.5 hover:bg-white/70"><X size={13} /></button>
        </span>
      ))}
      {onClear && chips.length > 1 && <button onClick={onClear} className="ml-1 text-[12.5px] font-medium text-ink-soft hover:text-brand">Clear all</button>}
    </div>
  );
}

const AVATAR_TINTS = ["#e6f2f0", "#ebe8df", "#e3ecea", "#f1ece2", "#e8eeec"];
export function initials(name?: string | null) {
  if (!name) return "–";
  return name.replace(/^(Dr\.|Prof\.)\s*/, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
export function Avatar({ name, size = 22 }: { name?: string | null; size?: number }) {
  const h = [...(name ?? "")].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-brand-hover ring-1 ring-inset ring-line"
      style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_TINTS[h % AVATAR_TINTS.length] }} title={name ?? undefined} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Owner({ name }: { name?: string | null }) {
  if (!name) return <span className="text-ink-soft">–</span>;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Avatar name={name} /><span className="truncate">{name}</span></span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface px-1 font-mono text-[11px] text-ink-soft">{children}</kbd>;
}

/* ================================================================ tooltip */
export function Tooltip({ content, children, className = "" }: { content: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={`group/tt relative inline-flex ${className}`}>
      {children}
      <span role="tooltip" className="glass pointer-events-none invisible absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-[260px] -translate-x-1/2 translate-y-1 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-ink opacity-90 transition-[transform] duration-150 group-hover/tt:visible group-hover/tt:translate-y-0 group-focus-within/tt:visible">
        {content}
      </span>
    </span>
  );
}

/* ================================================================ dialogs */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function Modal({ title, children, onClose, footer, wide }: {
  title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean;
}) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-ink/25 p-4 pt-[9vh]" role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ y: 8, opacity: 0.7 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.18 }}
        className={`w-full rounded-2xl border border-line bg-surface shadow-float ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface-2 hover:text-ink"><X size={17} /></button>
        </div>
        <div className="space-y-3.5 px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </motion.div>
    </div>
  );
}

/** Right-hand side sheet for quick previews. */
export function Drawer({ open, title, subtitle, onClose, children, footer }: {
  open: boolean; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => { if (open) panel.current?.focus(); }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65]" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Preview"}>
          <motion.div className="absolute inset-0 bg-ink/20" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }} onClick={onClose} />
          <motion.div ref={panel} tabIndex={-1}
            className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-line bg-surface shadow-float outline-none"
            initial={{ x: 48, opacity: 0.6 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 48, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}>
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="text-[16px] font-semibold">{title}</div>
                {subtitle && <div className="mt-0.5 text-[12.5px] text-ink-soft">{subtitle}</div>}
              </div>
              <button aria-label="Close preview" onClick={onClose} className="rounded-md p-1 text-ink-soft hover:bg-surface-2 hover:text-ink"><X size={17} /></button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ================================================================ forms and small pieces */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-soft">{hint}</span>}
    </label>
  );
}

export function KeyVal({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line text-[13.5px]">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="shrink-0 text-ink-soft">{k}</dt>
          <dd className="min-w-0 text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Collapsible({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between py-1 text-left text-[13.5px] font-medium text-brand">
        {title}<ChevronDown size={16} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="enter pt-2">{children}</div>}
    </div>
  );
}

export function DraftLabel() {
  return <Stamp tone="soon">Draft, to be reviewed by the officer</Stamp>;
}

/** Segmented tabs with a sliding indicator. */
export function Tabs({ tabs, value, onChange, className = "mb-4" }: {
  tabs: { id: string; label: ReactNode }[]; value: string; onChange: (id: string) => void; className?: string;
}) {
  const reduce = useReducedMotion();
  const uid = useId();
  return (
    <div role="tablist" className={`inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-line bg-surface-2 p-1 ${className}`}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`relative rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${value === t.id ? "text-ink" : "text-ink-soft hover:text-ink"}`}>
          {value === t.id && (
            <motion.span layoutId={`tab-${uid}`} className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-line"
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }} />
          )}
          <span className="relative">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ================================================================ "On this page" */
export function Toc({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-96px 0px -60% 0px", threshold: 0 });
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [items]);
  return (
    <nav aria-label="On this page" className="sticky top-24 hidden text-[13px] xl:block">
      <div className="mb-2 text-[12px] font-semibold text-ink">On this page</div>
      <ul className="space-y-0.5 border-l border-line">
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className={`-ml-px block border-l py-1 pl-3 no-underline transition-colors ${active === i.id ? "border-brand font-medium text-brand" : "border-transparent text-ink-soft hover:text-ink"}`}>
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Two-column documentation layout: content plus a sticky "On this page" list. */
export function DocLayout({ toc, children }: { toc: { id: string; label: string }[]; children: ReactNode }) {
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_200px]">
      <div className="min-w-0">{children}</div>
      <aside><Toc items={toc} /></aside>
    </div>
  );
}
