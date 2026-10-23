"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Gavel, Landmark } from "lucide-react";
import { Avatar } from "@/components/ui";
import { demoUsers, switchUser, type DemoUser } from "@/lib/actions";
import { useApp, type Role } from "@/lib/store";

const ROLES: { role: Role; title: string; icon: React.ReactNode; blurb: string }[] = [
  { role: "institution", title: "Institution", icon: <Building2 size={17} />, blurb: "Applies, replies to deficiencies, sends evidence and renewals." },
  { role: "official", title: "Official", icon: <Landmark size={17} />, blurb: "Scrutinises cases, verifies evidence, watches deadlines." },
  { role: "committee", title: "Committee", icon: <Gavel size={17} />, blurb: "Does expert visits and gives recommendations." },
];

/** One line on why to pick each featured demo user. */
const WHY: Record<string, string> = {
  "inst-AMB": "Has deadlines coming up",
  "off-NR-1": "Regional officer",
  "rd-NR": "Records decisions",
  "bureau-head": "All Regions; edits rules",
  "evc-1": "Has a visit today",
  "sac-1": "Has a case to review",
};

/** Demo sign-in: featured users grouped by role, one click to sign in, plus every other demo user. */
export function UserPicker({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const current = useApp((s) => s.user);
  const [users, setUsers] = useState<DemoUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [other, setOther] = useState("");
  useEffect(() => { demoUsers().then(setUsers).catch((e) => setError((e as Error).message)); }, []);
  const byRole = useMemo(() => {
    const out: Record<Role, DemoUser[]> = { institution: [], official: [], committee: [] };
    (users ?? []).filter((u) => u.featured).forEach((u) => out[u.role].push(u));
    return out;
  }, [users]);

  const choose = async (id: number) => {
    setBusy(id);
    const u = await switchUser(id);
    setBusy(null);
    if (!u) return;
    onDone?.();
    router.push(u.role === "committee" ? "/my-cases" : "/");
  };

  if (error) return <div className="rounded-xl border border-danger/30 bg-danger-tint p-4 text-[13.5px] text-danger-ink">{error} Start the app with <code className="mono">pnpm dev</code> and reload.</div>;

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-3">
        {ROLES.map((r) => (
          <section key={r.role} className="flex flex-col rounded-2xl border border-line bg-surface">
            <div className="flex items-start gap-3 px-4 pb-2 pt-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">{r.icon}</span>
              <div><div className="text-[14.5px] font-semibold">{r.title}</div><div className="text-[12px] text-ink-soft">{r.blurb}</div></div>
            </div>
            <div className="flex-1 space-y-1.5 p-2.5 pt-1">
              {!users && [0, 1].map((i) => <div key={i} className="skeleton h-[52px]" />)}
              {byRole[r.role].map((u) => (
                <button key={u.id} onClick={() => choose(u.id)} disabled={busy != null}
                  className="group flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-left transition-[border-color,background-color] hover:border-brand/50 hover:bg-surface disabled:opacity-60">
                  <Avatar name={u.name} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{u.name}</span>
                    <span className="block truncate text-[12px] text-ink-soft">{current?.id === u.id ? <span className="font-medium text-brand">Signed in now</span> : WHY[u.code] ?? u.designation}</span>
                  </span>
                  {busy === u.id ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-r-transparent" aria-hidden />
                    : <ArrowRight size={15} className="shrink-0 text-ink-soft group-hover:text-brand" />}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {users && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <label htmlFor="other-user" className="text-ink-soft">Or another demo user:</label>
          <select id="other-user" className="field h-9 w-auto max-w-[360px] py-0" value={other} onChange={(e) => setOther(e.target.value)}>
            <option value="">Choose…</option>
            {ROLES.map((r) => (
              <optgroup key={r.role} label={r.title}>
                {users.filter((u) => u.role === r.role).map((u) => <option key={u.id} value={u.id}>{u.name}, {u.institution ?? u.designation}</option>)}
              </optgroup>
            ))}
          </select>
          <button disabled={!other || busy != null} onClick={() => choose(Number(other))}
            className="inline-flex h-9 items-center rounded-lg border border-brand bg-brand px-3.5 text-[13px] font-medium text-white shadow-sm hover:bg-brand-hover disabled:opacity-50">Sign in</button>
        </div>
      )}
    </div>
  );
}
