"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Check, ChevronDown, Users } from "lucide-react";
import { Avatar } from "@/components/ui";
import { demoUsers, switchUser, type DemoUser } from "@/lib/actions";
import type { SessionUser } from "@/lib/store";
import { Popover } from "./Popover";

export const ROLE_TEXT = { institution: "Institution", official: "Official", committee: "Committee" } as const;

export function scopeText(user: SessionUser) {
  return user.institution_name ?? (user.is_bureau ? "Approval Bureau" : user.region_name ? `${user.region_name} Region` : user.committee_kind === "SAC" ? "SAC/SHC" : "Expert Visit Committee");
}

export function homeFor(role: SessionUser["role"]) {
  return role === "committee" ? "/my-cases" : "/";
}

/** Avatar menu: who you are, and the demo role switcher. */
export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<DemoUser[]>([]);
  useEffect(() => { if (open && !users.length) demoUsers().then(setUsers).catch(() => undefined); }, [open, users.length]);

  const pick = async (id: number) => {
    setOpen(false);
    const u = await switchUser(id);
    if (u) router.push(homeFor(u.role));
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Switch demo user. Signed in as ${user.name}, ${ROLE_TEXT[user.role]}`}
        className="flex h-9 items-center gap-1.5 rounded-lg pl-1 pr-1.5 hover:bg-surface">
        <Avatar name={user.name} size={28} />
        <ChevronDown size={14} className="text-ink-soft" aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={320} label="Account and demo user">
        <div className="flex items-center gap-3 px-3 pb-2.5 pt-2">
          <Avatar name={user.name} size={36} />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">{user.name}</div>
            <div className="truncate text-[12px] text-ink-soft">{ROLE_TEXT[user.role]} · {scopeText(user)}</div>
          </div>
        </div>
        <div className="border-t border-line pt-1.5" role="menu">
          <div className="px-3 pb-1 pt-1 text-[11.5px] font-medium text-ink-soft">Switch demo user</div>
          {!users.length && <div className="px-3 py-2 text-[12.5px] text-ink-soft">Loading…</div>}
          {users.filter((u) => u.featured).map((u) => (
            <button key={u.id} role="menuitem" onClick={() => pick(u.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left hover:bg-surface-2">
              <Avatar name={u.name} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{u.name}</span>
                <span className="block truncate text-[11.5px] text-ink-soft">{ROLE_TEXT[u.role]} · {u.designation}</span>
              </span>
              {u.id === user.id && <Check size={15} className="text-brand" aria-label="current" />}
            </button>
          ))}
        </div>
        <div className="mt-1 border-t border-line pt-1">
          <Link href="/welcome" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] text-ink no-underline hover:bg-surface-2">
            <Users size={14} className="text-ink-soft" /> All {users.length || ""} demo users
          </Link>
          <Link href="/guide" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] text-ink no-underline hover:bg-surface-2">
            <BookOpen size={14} className="text-ink-soft" /> Guide and demo scenario
          </Link>
          <div className="px-3 pb-1.5 pt-1 text-[11.5px] text-ink-soft">Demo sign-in. Real login is future scope.</div>
        </div>
      </Popover>
    </div>
  );
}
