"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BellRing, Check, GitBranch, Play, PlayCircle, RotateCcw, ShieldCheck, TimerReset } from "lucide-react";
import { Button, Callout, DocLayout, HelpBox, Kbd, PageHeader, Section, Stamp } from "@/components/ui";
import { api } from "@/lib/api";
import { toast, useApp } from "@/lib/store";

interface Step { id: number; title: string; who: string }
interface Result { caption: string; link?: string; examples?: string[] }

const ROLES = [
  { role: "Institution", who: "Dr. Kavya Larkspur, Ambervale Institute", items: ["Home shows pending actions sorted by due date", "Reply to deficiencies on the case page", "Upload undertaking evidence and renewed documents"] },
  { role: "Official", who: "Arjun Wrenfield (Regional), Dr. Nandini Hazelbrook (Regional Director), Ritu Emberly (Bureau)", items: ["Dashboard and queue show what is late", "Scrutinise, return with a reason, complete; record decisions (Director or Bureau)", "Run the EVC board, verify evidence and renewals, watch escalations", "Bureau officers edit rules and timelines"] },
  { role: "Committee", who: "Prof. Vikram Duskwood (EVC), Dr. Sana Thistledown (SAC/SHC)", items: ["My cases lists only assigned visits and reviews", "Confirm availability, mark the visit conducted, submit the report", "Read the case summary and record a recommendation"] },
];

const TOC = [
  { id: "about", label: "About this prototype" },
  { id: "how", label: "How Argus works" },
  { id: "scenario", label: "Demo scenario" },
  { id: "roles", label: "Who does what" },
  { id: "controls", label: "Useful controls" },
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
  const done = Object.keys(results).length;

  return (
    <div>
      <PageHeader crumbs={[{ label: "Guide" }]} title="Guide and demo"
        description="How Argus works, who does what, and a guided scenario you can run step by step. Every caption is written from what actually happened."
        action={<Button kind="primary" busy={running === "all"} onClick={runAll} disabled={!nextId}><PlayCircle size={15} /> Run demo scenario</Button>} />
      <HelpBox id="guide">For a clean run press <b>Reset demo</b> first. Steps run as the named demo user; switch to that user from the avatar menu to see the same thing on their screens.</HelpBox>

      <DocLayout toc={TOC}>
        <div className="space-y-9">
          <section id="about" className="scroll-mt-28">
            <div className="surface p-5">
              <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><ShieldCheck size={18} className="text-brand" /> About this prototype</div>
              <p className="text-[13.5px] text-ink-soft">
                Argus is a prototype built for SIH 2026 (PS26262). It is <b className="font-medium text-ink">not an official AICTE system</b>. Read these before drawing conclusions from any screen:
              </p>
              <ul className="mt-3 grid gap-2 text-[13.5px] md:grid-cols-2">
                {[
                  ["Synthetic data", "Every institution, officer, committee member and case is fictional."],
                  ["Illustrative rules", "Routes, time limits, reminder days and escalation days are assumptions, not official APH figures."],
                  ["Humans decide", "Argus never approves, rejects, grants or denies. Decisions are recorded by the competent authority."],
                  ["Simulated delivery and time", "Emails and SMS are only logged, and the date is a simulated clock you can move forward."],
                  ["Demo sign-in", "A demo user picker stands in for real login. Access rules are still enforced on every request."],
                  ["Measured numbers", "Every count and KPI comes from the data or a real run; nothing is typed in by hand."],
                ].map(([k, v]) => (
                  <li key={k} className="flex gap-2.5 rounded-xl bg-surface-2 p-3 ring-1 ring-inset ring-line">
                    <Check size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                    <span><b className="font-medium">{k}.</b> <span className="text-ink-soft">{v}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <Section id="how" title="How Argus works">
            <div className="grid gap-3 md:grid-cols-2">
              {[
                [<GitBranch key="g" size={17} />, "Routes", "Each application type follows a configured list of stages. Finishing a stage moves the case on automatically."],
                [<TimerReset key="t" size={17} />, "Deadlines", "Every stage and item has a time limit from the Rules page. Time waiting on the institution is counted separately."],
                [<BellRing key="b" size={17} />, "Alerts", "Reminders before a deadline, an overdue alert after it, then escalation L1 to L3. Each fires once, on its day."],
                [<ShieldCheck key="s" size={17} />, "Audit", "Every change is written to a hash-chained log in the same transaction. Verify the chain on the Audit page."],
              ].map(([icon, title, text]) => (
                <div key={title as string} className="surface flex gap-3 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand">{icon}</span>
                  <div><div className="text-[14px] font-semibold">{title}</div><p className="text-[13px] text-ink-soft">{text}</p></div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="scenario" title="Demo scenario" description={`About 4 to 5 minutes. Run the steps in order. ${done} of ${steps.length} done.`}
            action={<Button small onClick={reset} disabled={running !== null}><RotateCcw size={13} /> Reset demo</Button>}>
            <ol className="relative space-y-2">
              <span className="absolute bottom-4 left-[27px] top-4 w-px bg-line" aria-hidden />
              {steps.map((s) => {
                const r = results[s.id];
                const next = s.id === nextId;
                return (
                  <li key={s.id} className={`relative rounded-xl border p-3 transition-colors ${r ? "border-brand/25 bg-brand-tint/40" : next ? "border-brand/40 bg-surface shadow-sm" : "border-line bg-surface"}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`mono relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${r ? "bg-brand text-white" : next ? "bg-surface text-brand ring-2 ring-brand" : "bg-surface-2 text-ink-soft ring-1 ring-line"}`}>{r ? <Check size={14} /> : s.id}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-medium">{s.title}</div>
                        <div className="text-[12px] text-ink-soft">As {s.who}</div>
                      </div>
                      {r ? <Stamp tone="closed">Done</Stamp> : (
                        <Button small kind={next ? "primary" : "secondary"} busy={running === s.id} disabled={running !== null} onClick={() => runOne(s.id)}><Play size={12} /> Run step</Button>
                      )}
                    </div>
                    {r && (
                      <div className="enter ml-10 mt-2 text-[13.5px]">
                        {r.caption}
                        {r.examples && r.examples.length > 0 && <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink-soft">{r.examples.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}</ul>}
                        {r.link && <Link href={r.link} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium no-underline">See it on screen <ArrowRight size={13} /></Link>}
                      </div>
                    )}
                  </li>
                );
              })}
              {!steps.length && [0, 1, 2].map((i) => <li key={i} className="skeleton h-[58px]" />)}
            </ol>
          </Section>

          <Section id="roles" title="Who does what" description="Three roles only. There is no admin role in this prototype.">
            <div className="grid gap-3 lg:grid-cols-3">
              {ROLES.map((r) => (
                <div key={r.role} className="surface p-4">
                  <div className="text-[14px] font-semibold">{r.role}</div>
                  <div className="text-[12px] text-ink-soft">{r.who}</div>
                  <ul className="mt-2.5 space-y-1.5 border-t border-line pt-2.5 text-[13px]">
                    {r.items.map((i) => <li key={i} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />{i}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          <Section id="controls" title="Useful controls">
            <div className="surface divide-y divide-line text-[13.5px]">
              {[
                ["Simulated date", <>The date chip in the top bar opens <b className="font-medium">+1 day</b>, <b className="font-medium">+7 days</b>, <b className="font-medium">+30 days</b> and Reset. Each advance runs the alert check for every day passed.</>],
                ["Switch user", "The avatar menu at the top right lists the demo users for each role."],
                ["Search", <>Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> to jump to any page or case, or to advance the clock.</>],
                ["Quick look", "Click a row in a case table to preview it in a side sheet; arrow keys move between rows and Enter opens."],
              ].map(([k, v]) => (
                <div key={k as string} className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_minmax(0,1fr)]"><div className="font-medium">{k}</div><div className="text-ink-soft">{v}</div></div>
              ))}
            </div>
            <div className="mt-4"><Callout kind="tip">Reset demo restores the seeded data and the simulated date, so the scenario above works the same way every time.</Callout></div>
          </Section>
        </div>
      </DocLayout>
    </div>
  );
}
