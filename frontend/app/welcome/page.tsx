"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Gavel, Landmark, ShieldCheck } from "lucide-react";
import { Mark } from "@/components/shell/Logo";
import { Avatar } from "@/components/ui";
import { api } from "@/lib/api";
import { useApp, type Role, type SessionUser } from "@/lib/store";

interface DemoUser {
  id: number; code: string; name: string; role: Role; designation: string; featured: boolean;
  institution: string | null; region: string | null; official_kind: string | null; rank: number | null;
}

const ROLE_INFO: Record<Role, { title: string; icon: React.ReactNode; blurb: string }> = {
  institution: {
    title: "Institution", icon: <Building2 size={19} />,
    blurb: "The applying college. Submits applications, answers deficiencies, uploads undertaking evidence and renewed documents.",
  },
  official: {
    title: "Official", icon: <Landmark size={19} />,
    blurb: "AICTE Regional or Bureau officer. Scrutiny, deficiencies, EVC scheduling, verification, escalations and reports.",
  },
  committee: {
    title: "Committee", icon: <Gavel size={19} />,
    blurb: "EVC and SAC/SHC members. Confirm availability, conduct visits, submit reports and record recommendations.",
  },
};

const WHY: Record<string, string> = {
  "inst-AMB": "Has a case in scrutiny, an undertaking due in 5 days and a lease expiring in 20 days.",
  "off-NR-1": "Regional officer with the scrutiny case used in the demo, plus evidence to verify.",
  "rd-NR": "Regional Director: competent authority who records decisions in the Northern Region.",
  "bureau-head": "Sees all Regions, escalations at L3, and edits the rules and timelines.",
  "evc-1": "EVC convenor with a visit to confirm and a visit due today.",
  "sac-1": "SAC/SHC member with a case summary waiting for a recommendation.",
};

export default function Welcome() {
  const router = useRouter();
  const setSession = useApp((s) => s.setSession);
  const bumpVersion = useApp((s) => s.bumpVersion);
  const [users, setUsers] = useState<DemoUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState("");

  useEffect(() => {
    api<{ users: DemoUser[] }>("/api/users/demo").then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  }, []);

  const byRole = useMemo(() => {
    const out: Record<Role, DemoUser[]> = { institution: [], official: [], committee: [] };
    (users ?? []).filter((u) => u.featured).forEach((u) => out[u.role].push(u));
    return out;
  }, [users]);

  const choose = async (id: number) => {
    await api("/api/session", { body: { user_id: id } });
    const r = await api<{ user: SessionUser }>("/api/session");
    setSession(r.user);
    bumpVersion();
    router.push(r.user.role === "committee" ? "/my-cases" : "/");
  };

  return (
    <div>
      <div className="header-wash -mx-4 mb-8 grid items-center gap-8 rounded-3xl px-4 py-8 sm:-mx-6 sm:px-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="enter">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-[12px] font-medium text-ink-soft ring-1 ring-inset ring-line">
            <Mark size={14} /> SIH 2026 · PS26262 · Prototype
          </div>
          <h1 className="max-w-[18ch] text-[40px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink">Argus keeps watch over every approval, deadline and undertaking.</h1>
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-ink-soft">
            One place that routes each application through its stages, reminds people before deadlines, escalates what slips,
            and records every step in a tamper-evident trail. Argus never approves or rejects anything: decisions stay with the competent authority.
          </p>
        </div>
        <div className="surface enter p-5 text-[13.5px]">
          <div className="mb-2.5 flex items-center gap-2 font-semibold"><ShieldCheck size={17} className="text-brand" /> Before you start</div>
          <ul className="list-disc space-y-1.5 pl-5 text-ink-soft marker:text-brand">
            <li>All institutions, people and cases are <b className="text-ink">synthetic and fictional</b>.</li>
            <li>Time is <b className="text-ink">simulated</b>. Open the date chip in the top bar and advance it to watch reminders and escalations fire.</li>
            <li>Emails and SMS are <b className="text-ink">simulated</b> and shown in a delivery log.</li>
            <li>This is a demo sign-in. You can switch user at any time from the avatar menu.</li>
          </ul>
        </div>
      </div>

      <h2 className="mb-3 text-[20px] font-semibold tracking-[-0.01em]">Choose who you are</h2>
      {error && <div className="mb-4 rounded-xl border border-danger/30 bg-danger-tint p-4 text-[13.5px] text-danger-ink">{error} Start the API with <code className="mono">pnpm dev</code> and reload.</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(ROLE_INFO) as Role[]).map((role) => (
          <section key={role} className="surface enter flex flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand">{ROLE_INFO[role].icon}</span>
              <div>
                <div className="text-[15.5px] font-semibold">{ROLE_INFO[role].title}</div>
                <div className="text-[12.5px] text-ink-soft">{ROLE_INFO[role].blurb}</div>
              </div>
            </div>
            <div className="flex-1 space-y-2 p-3">
              {!users && [0, 1].map((i) => <div key={i} className="skeleton h-[84px]" />)}
              {byRole[role].map((u) => (
                <button key={u.id} onClick={() => choose(u.id)}
                  className="group w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-brand/50 hover:bg-surface">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2"><Avatar name={u.name} size={26} /><span className="truncate text-[13.5px] font-medium text-ink">{u.name}</span></span>
                    <ArrowRight size={15} className="shrink-0 text-ink-soft transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                  </div>
                  <div className="mt-1 text-[12px] text-ink-soft">{u.designation}</div>
                  {WHY[u.code] && <div className="mt-1 text-[12.5px] text-ink">{WHY[u.code]}</div>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {users && (
        <div className="mt-6 flex flex-wrap items-center gap-3 text-[13.5px]">
          <label htmlFor="other" className="text-ink-soft">Or pick any of the {users.length} demo users:</label>
          <select id="other" className="field max-w-md" value={other} onChange={(e) => setOther(e.target.value)}>
            <option value="">Select a user…</option>
            {(["institution", "official", "committee"] as Role[]).map((r) => (
              <optgroup key={r} label={ROLE_INFO[r].title}>
                {users.filter((u) => u.role === r).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}, {u.institution ?? u.designation}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button disabled={!other} onClick={() => choose(Number(other))}
            className="inline-flex h-9 items-center rounded-lg border border-brand bg-brand px-3.5 text-[13.5px] font-medium text-white shadow-sm hover:bg-brand-hover disabled:opacity-50">Continue</button>
        </div>
      )}
    </div>
  );
}
