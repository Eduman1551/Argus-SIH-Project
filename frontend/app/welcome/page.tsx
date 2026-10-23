"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Gavel, Landmark, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useApp, type Role, type SessionUser } from "@/lib/store";

interface DemoUser {
  id: number; code: string; name: string; role: Role; designation: string; featured: boolean;
  institution: string | null; region: string | null; official_kind: string | null; rank: number | null;
}

const ROLE_INFO: Record<Role, { title: string; icon: React.ReactNode; blurb: string }> = {
  institution: {
    title: "Institution", icon: <Building2 size={22} />,
    blurb: "The applying college. Submits applications, answers deficiencies, uploads undertaking evidence and renewed documents.",
  },
  official: {
    title: "Official", icon: <Landmark size={22} />,
    blurb: "AICTE Regional or Bureau officer. Scrutiny, deficiencies, EVC scheduling, verification, escalations and reports.",
  },
  committee: {
    title: "Committee", icon: <Gavel size={22} />,
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
      <div className="mb-8 grid items-center gap-8 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-deep">SIH 2026 · PS26262 · Prototype</div>
          <h1 className="font-serif text-[40px] font-semibold leading-[1.1] text-ink">Argus keeps watch over every approval, deadline and undertaking.</h1>
          <p className="mt-3 max-w-2xl text-[16px] text-ink-soft">
            One place that routes each application through its stages, reminds people before deadlines, escalates what slips,
            and records every step in a tamper-evident trail. Argus never approves or rejects anything: decisions stay with the competent authority.
          </p>
        </div>
        <div className="sheet p-5 text-[14px]">
          <div className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-brand" /> Before you start</div>
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>All institutions, people and cases are <b className="text-ink">synthetic and fictional</b>.</li>
            <li>Time is <b className="text-ink">simulated</b>. Use +1d, +7d and +30d in the top bar to watch reminders and escalations fire.</li>
            <li>Emails and SMS are <b className="text-ink">simulated</b> and shown in a delivery log.</li>
            <li>This is a demo sign-in. You can switch user at any time from the top bar.</li>
          </ul>
        </div>
      </div>

      <h2 className="mb-3 font-serif text-[22px] font-semibold">Choose who you are</h2>
      {error && <div className="sheet border-brand/40 p-4 text-brand-deep">{error} Start the API with <code>pnpm dev</code> and reload.</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(ROLE_INFO) as Role[]).map((role) => (
          <section key={role} className="sheet settle flex flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-brand-deep">{ROLE_INFO[role].icon}</span>
              <div>
                <div className="font-serif text-[19px] font-semibold">{ROLE_INFO[role].title}</div>
                <div className="text-[12.5px] text-ink-soft">{ROLE_INFO[role].blurb}</div>
              </div>
            </div>
            <div className="flex-1 space-y-2 p-3">
              {!users && [0, 1].map((i) => <div key={i} className="skeleton h-[74px]" />)}
              {byRole[role].map((u) => (
                <button key={u.id} onClick={() => choose(u.id)}
                  className="group w-full rounded-md border border-line bg-paper/60 px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{u.name}</span>
                    <ArrowRight size={16} className="text-ink-soft group-hover:text-brand" />
                  </div>
                  <div className="text-[12.5px] text-ink-soft">{u.designation}</div>
                  {WHY[u.code] && <div className="mt-1 text-[12.5px] text-ink">{WHY[u.code]}</div>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {users && (
        <div className="mt-6 flex flex-wrap items-center gap-3 text-[14px]">
          <label htmlFor="other" className="text-ink-soft">Or pick any of the {users.length} demo users:</label>
          <select id="other" className="input max-w-md" value={other} onChange={(e) => setOther(e.target.value)}>
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
            className="rounded-md border border-brand bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-deep disabled:opacity-50">Continue</button>
        </div>
      )}
    </div>
  );
}
