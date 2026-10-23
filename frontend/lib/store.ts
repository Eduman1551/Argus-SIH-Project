"use client";

import { create } from "zustand";

export type Role = "institution" | "official" | "committee";

export interface SessionUser {
  id: number;
  code: string;
  name: string;
  role: Role;
  designation: string;
  official_kind: "regional" | "bureau" | null;
  rank: number | null;
  committee_kind: "EVC" | "SAC" | null;
  region_id: number | null;
  region_name: string | null;
  institution_id: number | null;
  institution_name: string | null;
  is_bureau: boolean;
  can_decide: boolean;
}

export interface ClockState {
  now: string;
  today: string;
  seed_today: string;
  days_since_seed: number;
  last_tick: string | null;
  simulated: boolean;
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

export type Connection = "connecting" | "live" | "waking" | "offline";

interface AppState {
  user: SessionUser | null;
  sessionLoaded: boolean;
  clock: ClockState | null;
  version: number;
  unread: number;
  connection: Connection;
  pending: number; // requests in flight longer than the cold-start threshold
  toasts: Toast[];
  setSession: (user: SessionUser | null) => void;
  setLive: (clock: ClockState, version: number, unread: number) => void;
  bumpVersion: () => void;
  setConnection: (c: Connection) => void;
  slowStart: () => void;
  slowEnd: () => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;
}

let toastId = 1;

export const useApp = create<AppState>((set) => ({
  user: null,
  sessionLoaded: false,
  clock: null,
  version: 0,
  unread: 0,
  connection: "connecting",
  pending: 0,
  toasts: [],
  setSession: (user) => set({ user, sessionLoaded: true }),
  setLive: (clock, version, unread) =>
    set((s) => ({
      clock,
      unread,
      version: Math.max(s.version, version),
      connection: "live",
    })),
  bumpVersion: () => set((s) => ({ version: s.version + 0.001 })),
  setConnection: (connection) => set({ connection }),
  slowStart: () => set((s) => ({ pending: s.pending + 1 })),
  slowEnd: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
  toast: (kind, text) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-4) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (t: string) => useApp.getState().toast("success", t),
  error: (t: string) => useApp.getState().toast("error", t),
  info: (t: string) => useApp.getState().toast("info", t),
};
