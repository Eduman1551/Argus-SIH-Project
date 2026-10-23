import {
  AlertOctagon, BarChart3, Bell, BookOpen, Briefcase, CalendarClock, ClipboardCheck, FileClock, FileText, FolderOpen,
  Gauge, Home, Inbox, Settings2, ShieldCheck, type LucideIcon,
} from "lucide-react";
import type { Role, SessionUser } from "@/lib/store";

export interface NavLink { href: string; label: string; icon: LucideIcon; hint?: string }
export interface NavGroup { label: string; href?: string; items?: NavLink[] }

export const PAGES: Record<string, NavLink> = {
  home: { href: "/", label: "Home", icon: Home, hint: "What is due" },
  overview: { href: "/", label: "Overview", icon: Gauge, hint: "Where cases stand" },
  queue: { href: "/queue", label: "My queue", icon: Inbox, hint: "Your work" },
  applications: { href: "/applications", label: "Applications", icon: FolderOpen, hint: "All cases" },
  evc: { href: "/evc", label: "Expert visits", icon: CalendarClock, hint: "Visit scheduling board" },
  compliance: { href: "/compliance", label: "Compliance", icon: ClipboardCheck, hint: "Undertakings to verify" },
  validity: { href: "/validity", label: "Document validity", icon: FileClock, hint: "Leases and expiring documents" },
  escalations: { href: "/escalations", label: "Escalations", icon: AlertOctagon, hint: "Overdue items sent up the chain" },
  reports: { href: "/reports", label: "Reports", icon: FileText, hint: "Download as CSV" },
  audit: { href: "/audit", label: "Audit trail", icon: ShieldCheck, hint: "Who did what, and when" },
  performance: { href: "/performance", label: "Performance", icon: BarChart3, hint: "How well deadlines are met" },
  rules: { href: "/settings/rules", label: "Rules", icon: Settings2, hint: "Time limits and reminders" },
  undertakings: { href: "/undertakings", label: "Undertakings", icon: ClipboardCheck, hint: "Conditions to meet" },
  documents: { href: "/documents", label: "Documents", icon: FileClock, hint: "Renew before expiry" },
  myCases: { href: "/my-cases", label: "My cases", icon: Briefcase, hint: "Your visits and reviews" },
  notifications: { href: "/notifications", label: "Notifications", icon: Bell, hint: "Your alerts" },
  guide: { href: "/guide", label: "Guide", icon: BookOpen, hint: "How to use Argus" },
};

export function navFor(user: SessionUser): NavGroup[] {
  const P = PAGES;
  const byRole: Record<Role, NavGroup[]> = {
    official: [
      { label: "Overview", href: "/" },
      { label: "Cases", items: [P.queue, P.applications] },
      { label: "Monitoring", items: [P.evc, P.compliance, P.validity, P.escalations] },
      { label: "Reports", items: [P.reports, P.performance, P.audit] },
      ...(user.is_bureau ? [{ label: "Rules", href: P.rules.href }] : []),
    ],
    institution: [
      { label: "Home", href: "/" },
      { label: "Applications", href: "/applications" },
      { label: "Undertakings", href: "/undertakings" },
      { label: "Documents", href: "/documents" },
    ],
    committee: [
      { label: "My cases", href: "/my-cases" },
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
