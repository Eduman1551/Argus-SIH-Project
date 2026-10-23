"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellRing, Check, GitBranch, Play, PlayCircle, RotateCcw, ShieldCheck, TimerReset } from "lucide-react";
import { Button, Card, HelpBox, PageHeader, Stamp } from "@/components/ui";
import { api } from "@/lib/api";
import { toast, useApp } from "@/lib/store";

interface Step { id: number; title: string; who: string }
interface Result { caption: string; link?: string; examples?: string[] }

const ROLES = [
  { role: "Institution", who: "Dr. Kavya Larkspur, Ambervale Institute", items: ["Home shows pending actions sorted by due date", "Reply to deficiencies on the case page", "Upload undertaking evidence and renewed documents"] },
  { role: "Official", who: "Arjun Wrenfield (Regional), Dr. Nandini Hazelbrook (Regional Director), Ritu Emberly (Bureau)", items: ["Dashboard and queue show what is late", "Scrutinise, return with a reason, complete; record decisions (Director or Bureau)", "Run the EVC board, verify evidence and renewals, watch escalations", "Bureau officers edit rules and timelines"] },
  { role: "Committee", who: "Prof. Vikram Duskwood (EVC), Dr. Sana Thistledown (SAC/SHC)", items: ["My cases lists only assigned visits and reviews", "Confirm availability, mark the visit conducted, submit the report", "Read the case summary and record a recommendation"] },
];

export default function GuidePage() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [results, setResults] = useState<Record<number, Result>>({});
  const [running, setRunning] = useState<number | "all" | null>(null);
  const bump = useApp((s) => s.bumpVersion);

  useEffect(() => { api<Step[]>("/api/demo/scenario").then(setSteps).catch(() => undefined); }, []);

  const run = async (id: number): Promise<boolean> => {
    try {
      const r = await api<Result>(`/api/demo/scenario/${id}`, { body: {} });
      setResults((x) => ({ ...x, [id]: r }));
      bump();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };
  const runOne = async (id: number) => { setRunning(id); await run(id); setRunning(null); };
  const runAll = async () => {
    setRunning("all");
    for (const s of steps) {
      if (results[s.id]) continue;
      if (!(await run(s.id))) break;
    }
    setRunning(null);
  };
  const reset = async () => {
    setRunning("all");
    try {
      await api("/api/demo/reset", { body: {} });
      setResults({});
      bump();
      toast.success("Demo data and clock restored.");
    } catch (e) { toast.error((e as Error).message); }
    setRunning(null);
  };
  const nextId = steps.find((s) => !results[s.id])?.id;

  return (
    <div>
      <PageHeader title="Guide and demo" description="How Argus works, who does what, and a guided scenario you can run step by step. Every caption is written from what actually happened."
        action={<Button kind="primary" busy={running === "all"} onClick={runAll} disabled={!nextId}><PlayCircle size={16} /> Run demo scenario</Button>} />
      <HelpBox id="guide">For a clean run press <b>Reset demo</b> first. Steps run as the named demo user; you can switch to that user from the top bar to see the same thing on their screens.</HelpBox>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          [<GitBranch key="g" />, "Routes", "Each application type follows a configured list of stages. Finishing a stage moves the case on automatically."],
          [<TimerReset key="t" />, "Deadlines", "Every stage and item has a time limit from the Rules page. Time waiting on the institution is counted separately."],
          [<BellRing key="b" />, "Alerts", "Reminders before a deadline, an overdue alert after it, then escalation L1 to L3. Each fires once, on its day."],
          [<ShieldCheck key="s" />, "Audit", "Every change is written to a hash-chained log in the same transaction. Verify the chain on the Audit page."],
        ].map(([icon, title, text]) => (
          <div key={title as string} className="sheet settle p-4">
            <div className="mb-1 flex items-center gap-2 font-serif text-[17px] font-semibold"><span className="text-brand">{icon}</span>{title}</div>
            <p className="text-[14px] text-ink-soft">{text}</p>
          </div>
        ))}
      </div>

      <Card title="Demo scenario" subtitle="About 4 to 5 minutes. Run steps in order." className="mb-6"
        action={<Button small onClick={reset} disabled={running !== null}><RotateCcw size={14} /> Reset demo</Button>}>
        <ol className="space-y-3">
          {steps.map((s) => {
            const r = results[s.id];
            return (
              <li key={s.id} className={`rounded-md border p-3 ${r ? "border-olive/50 bg-olive-tint/30" : s.id === nextId ? "border-brand/50 bg-card" : "border-line bg-paper/40"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold ${r ? "bg-olive text-white" : "bg-brand-tint text-brand-deep"}`}>{r ? <Check size={15} /> : s.id}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{s.title}</div>
                    <div className="text-[12.5px] text-ink-soft">As {s.who}</div>
                  </div>
                  {r ? <Stamp tone="closed">Done</Stamp> : (
                    <Button small kind={s.id === nextId ? "primary" : "secondary"} busy={running === s.id} disabled={running !== null} onClick={() => runOne(s.id)}><Play size={13} /> Run step</Button>
                  )}
                </div>
                {r && (
                  <div className="mt-2 border-l-2 border-olive pl-3 text-[14px]">
                    {r.caption}
                    {r.examples && r.examples.length > 0 && <ul className="mt-1 list-disc pl-5 text-[13px] text-ink-soft">{r.examples.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}</ul>}
                    {r.link && <div className="mt-1"><Link href={r.link} className="text-[13px]">See it on screen →</Link></div>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      <h2 className="mb-3 font-serif text-[22px] font-semibold">Who does what</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {ROLES.map((r) => (
          <Card key={r.role} title={r.role} subtitle={r.who}>
            <ul className="list-disc space-y-1 pl-5 text-[14px]">{r.items.map((i) => <li key={i}>{i}</li>)}</ul>
          </Card>
        ))}
      </div>
      <Card title="Honest notes">
        <ul className="list-disc space-y-1 pl-5 text-[14px]">
          <li>All data is synthetic. Institutions, officers and committee members are fictional.</li>
          <li>Rules, time limits and reminder days are illustrative assumptions, not official APH figures.</li>
          <li>Email and SMS are simulated; the delivery log shows what would be sent.</li>
          <li>Sign-in is a demo user picker. Real login and SSO are future scope.</li>
          <li>Argus never approves, rejects, grants or denies. Decisions are recorded by the competent authority.</li>
        </ul>
      </Card>
    </div>
  );
}
