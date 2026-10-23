"use client";

import { useState } from "react";
import { CalendarClock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { advanceClock, resetDemo } from "@/lib/actions";
import { fmtDate, fmtWeekday } from "@/lib/format";
import { useApp } from "@/lib/store";
import { Popover } from "./Popover";

function compact(iso?: string) {
  if (!iso) return "…";
  return `${fmtWeekday(iso).slice(0, 3)} ${fmtDate(iso).slice(0, 6)}`;
}

/** The simulated platform clock: a compact chip with a popover to advance or reset. */
export function ClockChip() {
  const { clock, connection } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const run = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    await fn();
    setBusy(null);
  };
  const dot = { live: "bg-brand", connecting: "bg-muted", waking: "bg-warn", offline: "bg-danger" }[connection] ?? "bg-muted";

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Simulated date ${clock ? fmtDate(clock.today) : ""}. Open clock controls`}
        className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface/70 px-2.5 text-[13px] font-medium text-ink hover:bg-surface">
        <span className="relative flex">
          <CalendarClock size={15} className="text-brand" aria-hidden />
          <span className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-white ${dot}`} title={connection} />
        </span>
        <span className="mono whitespace-nowrap">{compact(clock?.today)}</span>
      </button>
      <Popover open={open} onClose={() => { setOpen(false); setConfirmReset(false); }} width={300} label="Simulated clock">
        <div className="px-3 pb-2 pt-2.5">
          <div className="text-[12px] font-medium text-ink-soft">Simulated date</div>
          <div className="mono mt-0.5 text-[17px] font-semibold">{clock ? `${fmtWeekday(clock.today)}, ${fmtDate(clock.today)}` : "…"}</div>
          <div className="mt-0.5 text-[12px] text-ink-soft">
            {clock ? (clock.days_since_seed ? `${clock.days_since_seed} day(s) after the seeded date` : "The seeded starting date") : ""}
            {" · "}{connection === "live" ? "live" : connection}
          </div>
        </div>
        <div className="border-t border-line px-3 py-2.5">
          <div className="mb-2 text-[12px] text-ink-soft">Move time forward. Every reminder and escalation that falls due fires on its own day.</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 7, 30].map((d) => (
              <Button key={d} small kind={d === 7 ? "primary" : "secondary"} busy={busy === `+${d}`} disabled={!!busy}
                onClick={() => run(`+${d}`, () => advanceClock(d))}>
                +{d} day{d > 1 ? "s" : ""}
              </Button>
            ))}
          </div>
        </div>
        <div className="border-t border-line px-3 py-2.5">
          {confirmReset ? (
            <div className="text-[12.5px]">
              <div className="mb-2 text-ink">Restore the seeded data and put the clock back to {clock ? fmtDate(clock.seed_today) : "the seed date"}?</div>
              <div className="flex gap-1.5">
                <Button small kind="danger" busy={busy === "reset"} onClick={() => run("reset", async () => { const ok = await resetDemo(); setConfirmReset(false); return ok; })}>Reset demo</Button>
                <Button small onClick={() => setConfirmReset(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmReset(true)} disabled={!!busy}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft hover:text-brand">
              <RotateCcw size={13} /> Reset demo data and clock
            </button>
          )}
        </div>
      </Popover>
    </div>
  );
}
