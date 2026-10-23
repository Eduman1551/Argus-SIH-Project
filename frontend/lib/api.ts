"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./store";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SLOW_MS = 2500; // longer than this on a request = probably a serverless cold start

/** Fetch JSON from the backend (relative /api paths, same origin). */
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData; quiet?: boolean } = {},
): Promise<T> {
  const store = useApp.getState();
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    store.slowStart();
  }, SLOW_MS);
  try {
    const res = await fetch(path, {
      method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (useApp.getState().connection === "offline") store.setConnection("live");
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      const msg = typeof data === "object" && data && "detail" in data ? String((data as { detail: unknown }).detail) : `Request failed (${res.status})`;
      if (res.status === 503) store.setConnection("offline");
      throw new ApiError(res.status, msg);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    store.setConnection("offline");
    throw new ApiError(0, "Cannot reach the server. Check that the API is running, then retry.");
  } finally {
    clearTimeout(timer);
    if (slow) store.slowEnd();
  }
}

/** Run an action, show a toast, and refresh every view on success. */
export async function act<T = unknown>(
  path: string,
  body?: unknown,
  success?: string,
  method = "POST",
): Promise<T | null> {
  try {
    const out = await api<T>(path, { method, body: body ?? {} });
    if (success) useApp.getState().toast("success", success);
    useApp.getState().bumpVersion();
    return out;
  } catch (e) {
    useApp.getState().toast("error", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function uploadFile(entityType: string, entityId: number, slot: string, file: File) {
  const form = new FormData();
  form.append("entity_type", entityType);
  form.append("entity_id", String(entityId));
  form.append("slot", slot);
  form.append("file", file);
  return api<{ id: number; version: number; sha256: string; size_bytes: number }>("/api/files", { form });
}

/**
 * Load data for a view. Refetches quietly whenever the live version changes
 * (any state change anywhere), keeping the old data on screen while it loads.
 */
export function useApi<T>(path: string | null) {
  const version = useApp((s) => s.version);
  const user = useApp((s) => s.user);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    try {
      const d = await api<T>(path);
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e as ApiError);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    setData(null);
  }, [path, user?.id]);

  useEffect(() => {
    if (user) void load();
  }, [load, version, user]);

  return { data, error, loading: loading && !data, reload: load };
}
