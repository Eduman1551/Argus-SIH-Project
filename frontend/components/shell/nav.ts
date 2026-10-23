import {
  AlertOctagon, BarChart3, Bell, BookOpen, Briefcase, CalendarClock, ClipboardCheck, FileClock, FileText, FolderOpen,
  Gauge, Home, Inbox, Settings2, ShieldCheck, type LucideIcon,
} from "lucide-react";
import type { Role, SessionUser } from "@/lib/store";

export interface NavLink { href: string; label: string; icon: LucideIcon; hint?: string }
export interface NavGroup { label: string; href?: string; items?: NavLink[] }

export const PAGES: Record<string, NavLink> = {
  home: { href: "/", label: "Home", icon: Home, hint: "Your applications and what is due" },
  overview: { href: "/", label: "Overview", icon: Gauge, hint: "Pendency, deadlines and Regions" },
  queue: { href: "/queue", label: "My queue", icon: Inbox, hint: "Work assigned to you" },
  applications: { href: "/applications", label: "Applications", icon: FolderOpen, hint: "Every case, filterable" },
  evc: { href: "/evc", label: "EVC board", icon: CalendarClock, hint: "Expert visits, from queue to report" },
  compliance: { href: "/compliance", label: "Compliance", icon: ClipboardCheck, hint: "Undertakings and evidence" },
  validity: { href: "/validity", label: "Document validity", icon: FileClock, hint: "Leases and other expiring documents" },
  escalations: { href: "/escalations", label: "Escalations", icon: AlertOctagon, hint: "Overdue items by level" },
  reports: { href: "/reports", label: "Reports", icon: FileText, hint: "Six reports with CSV export" },
  audit: { href: "/audit", label: "Audit trail", icon: ShieldCheck, hint: "Hash-chained record of every action" },
  performance: { href: "/performance", label: "Performance", icon: BarChart3, hint: "The eight KPIs, measured live" },
  rules: { href: "/settings/rules", label: "Rules and timelines", icon: Settings2, hint: "Routes, time limits, reminders" },
  undertakings: { href: "/undertakings", label: "Undertakings", icon: ClipboardCheck, hint: "Conditions and evidence" },
  documents: { href: "/documents", label: "Documents", icon: FileClock, hint: "Validity and renewals" },
  myCases: { href: "/my-cases", label: "My cases", icon: Briefcase, hint: "Visits and reviews assigned to you" },
  notifications: { href: "/notifications", label: "Notifications", icon: Bell, hint: "Alerts and the delivery log" },
  guide: { href: "/guide", label: "Guide", icon: BookOpen, hint: "How to use Argus and the demo" },
};

export function navFor(user: SessionUser): NavGroup[] {
  const P = PAGES;
  const byRole: Record<Role, NavGroup[]> = {
    official: [
      { label: "Overview", href: "/" },
      { label: "Cases", items: [P.queue, P.applications] },
      { label: "Monitoring", items: [P.evc, P.compliance, P.validity, P.escalations] },
      { label: "Insight", items: [P.reports, P.audit, P.performance] },
      ...(user.is_bureau ? [{ label: "Configure", items: [P.rules] }] : []),
    ],
    institution: [
      { label: "Home", href: "/" },
      { label: "Applications", href: "/applications" },
      { label: "Undertakings", href: "/undertakings" },
      { label: "Documents", href: "/documents" },
    ],
    committee: [
      { label: "My cases", href: "/my-cases" },
      { label: "Performance", href: "/performance" },
      { label: "Guide", href: "/guide" },
    ],
  };
  return byRole[user.role];
}

/** Every page this user can open, for the command palette. */
export function pagesFor(user: SessionUser): NavLink[] {
  const P = PAGES;
  const common = [P.notifications, P.performance, P.guide];
  if (user.role === "institution") return [P.home, P.applications, P.undertakings, P.documents, ...common];
  if (user.role === "committee") return [P.myCases, ...common];
  return [P.overview, P.queue, P.applications, P.evc, P.compliance, P.validity, P.escalations, P.reports, P.audit,
    ...(user.is_bureau ? [P.rules] : []), ...common];
}

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function groupActive(pathname: string, g: NavGroup) {
  if (g.href) {
    // case pages live under /applications but belong to Cases for officials
    return isActive(pathname, g.href);
  }
  return (g.items ?? []).some((i) => isActive(pathname, i.href))
    || (g.label === "Cases" && /^\/(applications|cases|visits)\//.test(pathname));
}
