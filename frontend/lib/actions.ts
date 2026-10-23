"use client";

import { api } from "./api";
import { useApp, type ClockState, type SessionUser } from "./store";

interface AdvanceResult {
  from: string; to: string; days: number; alerts: number; escalations: number; notifications: number;
  reminders?: number; overdue?: number; escalated_l1?: number; escalated_l2?: number; escalated_l3?: number;
}

async function refreshLive() {
  const r = await api<{ clock: ClockState; version: number; unread: number }>("/api/live");
  useApp.getState().setLive(r.clock, r.version, r.unread);
}

/** Summary written from the engine's real counts, e.g. "7 days advanced: 12 reminders sent, 3 items overdue, 1 escalated to L2". */
export function advanceSummary(r: AdvanceResult): string {
  const parts = [`${r.reminders ?? 0} reminder${r.reminders === 1 ? "" : "s"} sent`, `${r.overdue ?? 0} item${r.overdue === 1 ? "" : "s"} overdue`];
  const levels = ([1, 2, 3] as const)
    .map((l) => [l, r[`escalated_l${l}` as const] ?? 0] as const)
    .filter(([, n]) => n > 0);
  if (levels.length) parts.push(levels.map(([l, n], i) => (i === 0 ? `${n} escalated to L${l}` : `${n} to L${l}`)).join(", "));
  else parts.push("no new escalations");
  return `${r.days} day${r.days === 1 ? "" : "s"} advanced: ${parts.join(", ")}.`;
}

export async function advanceClock(days: number): Promise<boolean> {
  const s = useApp.getState();
  try {
    const r = await api<AdvanceResult>("/api/clock/advance", { body: { days } });
    s.toast("success", advanceSummary(r));
    s.bumpVersion();
    await refreshLive();
    return true;
  } catch (e) {
    s.toast("error", (e as Error).message);
    return false;
  }
}

export async function resetDemo(): Promise<boolean> {
  const s = useApp.getState();
  try {
    await api("/api/demo/reset", { body: {} });
    s.toast("success", "Demo data and the simulated clock are back to the seeded state.");
    s.bumpVersion();
    await refreshLive();
    return true;
  } catch (e) {
    s.toast("error", (e as Error).message);
    return false;
  }
}

/** Sign in as a demo user (also used to switch user). */
export async function switchUser(userId: number): Promise<SessionUser | null> {
  const s = useApp.getState();
  try {
    await api("/api/auth/login", { body: { user_id: userId } });
    const r = await api<{ user: SessionUser }>("/api/session");
    s.setSession(r.user);
    s.bumpVersion();
    s.toast("info", `Signed in as ${r.user.name} (${r.user.role === "official" ? "Official" : r.user.role === "institution" ? "Institution" : "Committee"}).`);
    return r.user;
  } catch (e) {
    s.toast("error", (e as Error).message);
    return null;
  }
}

/** Log out: the server expires the session cookie; every page then sends you to /login. */
export async function logout(): Promise<void> {
  const s = useApp.getState();
  try {
    await api("/api/auth/logout", { body: {} });
  } catch (e) {
    s.toast("error", (e as Error).message);
    return;
  }
  s.setSession(null);
  s.toast("info", "You are logged out.");
}

export interface DemoUser {
  id: number; code: string; name: string; role: SessionUser["role"]; designation: string; featured: boolean;
  institution: string | null; region: string | null;
}

let usersCache: DemoUser[] | null = null;
export async function demoUsers(): Promise<DemoUser[]> {
  if (!usersCache) usersCache = (await api<{ users: DemoUser[] }>("/api/users/demo")).users;
  return usersCache;
}
