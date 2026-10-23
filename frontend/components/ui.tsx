"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronUp, Clock3, Flag, Hourglass, Info, Lightbulb, X } from "lucide-react";
import { dueText } from "@/lib/format";

/* ---------------------------------------------------------------- layout */
export function PageHeader({ title, description, action, kicker }: {
  title: string; description: string; action?: ReactNode; kicker?: string;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-deep">{kicker}</div>}
        <h1 className="text-[28px] font-semibold leading-tight text-ink">{title}</h1>
        <p className="mt-1 max-w-3xl text-[15px] text-ink-soft">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Card({ title, subtitle, children, className = "", action, pad = true }: {
  title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; action?: ReactNode; pad?: boolean;
}) {
  return (
    <section className={`sheet settle ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold leading-snug">{title}</h2>}
            {subtitle && <p className="text-[13px] text-ink-soft">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Grid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 }) {
  const c = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 xl:grid-cols-4", 5: "md:grid-cols-3 xl:grid-cols-5" }[cols];
  return <div className={`grid grid-cols-1 gap-4 ${c}`}>{children}</div>;
}

/* ---------------------------------------------------------------- buttons */
type BtnKind = "primary" | "secondary" | "ghost" | "danger";
const BTN: Record<BtnKind, string> = {
  primary: "bg-brand text-white hover:bg-brand-deep border border-brand hover:border-brand-deep",
  secondary: "bg-card text-ink border border-line hover:bg-paper-2",
  ghost: "text-brand hover:bg-brand-tint border border-transparent",
  danger: "bg-card text-brand-deep border border-brand/60 hover:bg-brand-tint",
};

export function Button({ children, kind = "secondary", onClick, disabled, type = "button", small, title, busy }: {
  children: ReactNode; kind?: BtnKind; onClick?: () => void; disabled?: boolean; type?: "button" | "submit";
  small?: boolean; title?: string; busy?: boolean;
}) {
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${small ? "px-2.5 py-1 text-[13px]" : "px-3.5 py-2 text-sm"} ${BTN[kind]}`}>
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, kind = "secondary", small }: {
  href: string; children: ReactNode; kind?: BtnKind; small?: boolean;
}) {
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 rounded-md font-medium no-underline transition-colors ${small ? "px-2.5 py-1 text-[13px]" : "px-3.5 py-2 text-sm"} ${BTN[kind]}`}>
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------- stamps */
export type Tone = "ok" | "soon" | "overdue" | "escalated" | "closed" | "neutral" | "info" | "waiting";

export function Stamp({ tone, children, level }: { tone: Tone; children?: ReactNode; level?: number | null }) {
  if (tone === "overdue") return <span className="stamp stamp-solid"><AlertTriangle size={12} aria-hidden />{children ?? "Overdue"}</span>;
  if (tone === "escalated")
    return <span className="stamp stamp-deep" title={`Escalated to level ${level}`}><Flag size={12} aria-hidden />{children ?? `Escalated L${level}`}</span>;
  const cls: Record<string, string> = {
    ok: "text-olive-ink", closed: "text-olive-ink", soon: "text-ochre-ink", neutral: "text-ink-soft",
    waiting: "text-ink-soft", info: "text-brand",
  };
  const icon: Record<string, ReactNode> = {
    ok: <CheckCircle2 size={12} aria-hidden />, closed: <CheckCircle2 size={12} aria-hidden />,
    soon: <Clock3 size={12} aria-hidden />, waiting: <Hourglass size={12} aria-hidden />,
  };
  return <span className={`stamp ${cls[tone]}`}>{icon[tone]}{children}</span>;
}

export function SlaStamp({ status, days, level, waitingOn }: {
  status?: string | null; days?: number | null; level?: number | null; waitingOn?: string | null;
}) {
  if (level) return <span className="inline-flex flex-wrap items-center gap-1"><Stamp tone="escalated" level={level} />{status === "overdue" && <Stamp tone="overdue" />}</span>;
  if (status === "overdue") return <Stamp tone="overdue">Overdue{days != null ? ` ${-days}d` : ""}</Stamp>;
  if (status === "due_soon") return <Stamp tone="soon">Due soon</Stamp>;
  if (status === "decided") return <Stamp tone="closed">Decided</Stamp>;
  if (waitingOn === "institution") return <Stamp tone="waiting">With institution</Stamp>;
  return <Stamp tone="ok">On track</Stamp>;
}

export function DueCell({ date, days, fmt }: { date?: string | null; days?: number | null; fmt: (d?: string | null) => string }) {
  if (!date) return <span className="text-ink-soft">–</span>;
  const late = days != null && days < 0;
  return (
    <span className="whitespace-nowrap">
      {fmt(date)}
      {days != null && <span className={`block text-xs ${late ? "font-semibold text-brand" : days <= 3 ? "text-ochre-ink" : "text-ink-soft"}`}>{dueText(days)}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- stats */
export function Stat({ label, value, hint, tone, href }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "ochre" | "olive" | "ink"; href?: string;
}) {
  const color = { red: "text-brand", ochre: "text-ochre-ink", olive: "text-olive-ink", ink: "text-ink" }[tone ?? "ink"];
  const body = (
    <div className="sheet settle h-full px-4 py-3.5">
      <div className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft">{label}</div>
      <div className={`mt-1 font-serif text-[32px] font-semibold leading-none tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1.5 text-[13px] text-ink-soft">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block no-underline hover:[&>div]:border-brand/40">{body}</Link> : body;
}

/* ---------------------------------------------------------------- help, next, empty, skeleton */
export function HelpBox({ id, children }: { id: string; children: ReactNode }) {
  const key = `argus.help.${id}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(localStorage.getItem(key) !== "hidden");
  }, [key]);
  if (!open) {
    return (
      <button className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline"
        onClick={() => { localStorage.removeItem(key); setOpen(true); }}>
        <Lightbulb size={14} /> What to do here
      </button>
    );
  }
  return (
    <div className="settle mb-5 flex gap-3 rounded-lg border border-ochre/50 bg-ochre-tint/60 px-4 py-3 text-[14px]">
      <Lightbulb size={18} className="mt-0.5 shrink-0 text-ochre-ink" aria-hidden />
      <div className="min-w-0 flex-1"><div className="mb-0.5 font-semibold text-ink">What to do here</div><div className="text-ink">{children}</div></div>
      <button aria-label="Hide this tip" className="self-start rounded p-1 text-ink-soft hover:bg-paper-2"
        onClick={() => { localStorage.setItem(key, "hidden"); setOpen(false); }}><X size={16} /></button>
    </div>
  );
}

export function NextStep({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-8 flex justify-end border-t border-line/70 pt-4">
      <Link href={href} className="inline-flex items-center gap-2 rounded-md border border-line bg-card px-4 py-2 text-sm font-medium text-ink no-underline hover:border-brand/50 hover:text-brand">
        Next: {label} <ArrowRight size={16} />
      </Link>
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <div className="mb-1 text-ink-soft">{icon ?? <Info size={22} />}</div>
      <div className="font-serif text-[16px] font-semibold text-ink">{title}</div>
      {children && <div className="max-w-md text-[14px] text-ink-soft">{children}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", className = "" }: { h?: number; w?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h, width: w }} />;
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton h={30} w={320} className="mb-2" />
      <Skeleton h={16} w={520} className="mb-6" />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={92} />)}</div>
      <Skeleton h={260} />
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: { message: string; status?: number }; onRetry?: () => void }) {
  return (
    <div className="sheet flex items-center justify-between gap-3 border-brand/40 px-4 py-3 text-[14px]">
      <span className="flex items-center gap-2 text-brand-deep"><AlertTriangle size={16} />{error.message}</span>
      {onRetry && <Button small onClick={onRetry}>Retry</Button>}
    </div>
  );
}

/* ---------------------------------------------------------------- table */
export function Table({ children, minWidth }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="ledger" style={minWidth ? { minWidth } : undefined}>{children}</table>
    </div>
  );
}

/* ---------------------------------------------------------------- modal + fields */
export function Modal({ title, children, onClose, footer, wide }: {
  title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/35 p-4 pt-[8vh]" role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet settle w-full ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[18px] font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded p-1 text-ink-soft hover:bg-paper-2"><X size={18} /></button>
        </div>
        <div className="space-y-3 px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line/70 bg-paper-2/40 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12.5px] text-ink-soft">{hint}</span>}
    </label>
  );
}

export function KeyVal({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4 gap-y-1.5 text-[14px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Collapsible({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-1 text-left text-[14px] font-semibold text-brand">
        {title}<ChevronUp size={16} className={`transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && <div className="pt-2">{children}</div>}
    </div>
  );
}

export function DraftLabel() {
  return <span className="stamp text-ochre-ink">Draft, to be reviewed by the officer</span>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: ReactNode }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`-mb-px rounded-t-md border px-3.5 py-2 text-sm font-medium ${value === t.id ? "border-line border-b-card bg-card text-brand-deep" : "border-transparent text-ink-soft hover:text-ink"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
