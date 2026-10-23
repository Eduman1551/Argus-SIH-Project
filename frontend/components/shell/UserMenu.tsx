"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronDown, LogOut, Users } from "lucide-react";
import { UserPicker } from "@/components/auth/UserPicker";
import { Avatar, Modal } from "@/components/ui";
import { logout } from "@/lib/actions";
import type { SessionUser } from "@/lib/store";
import { Popover } from "./Popover";

export const ROLE_TEXT = { institution: "Institution", official: "Official", committee: "Committee" } as const;

export function scopeText(user: SessionUser) {
  return user.institution_name ?? (user.is_bureau ? "Approval Bureau" : user.region_name ? `${user.region_name} Region` : user.committee_kind === "SAC" ? "SAC/SHC" : "Expert Visit Committee");
}

export function homeFor(role: SessionUser["role"]) {
  return role === "committee" ? "/my-cases" : "/";
}

const ITEM = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-ink no-underline hover:bg-surface-2";

/** Avatar menu: who you are, Switch user and Log out. */
export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Account menu. Signed in as ${user.name}, ${ROLE_TEXT[user.role]}`}
        className="flex h-9 items-center gap-1.5 rounded-lg pl-1 pr-1.5 hover:bg-surface">
        <Avatar name={user.name} size={28} />
        <ChevronDown size={14} className="text-ink-soft" aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={280} label="Account">
        <div className="flex items-center gap-3 px-3 pb-2.5 pt-2">
          <Avatar name={user.name} size={36} />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">{user.name}</div>
            <div className="truncate text-[12px] text-ink-soft">{ROLE_TEXT[user.role]} · {scopeText(user)}</div>
          </div>
        </div>
        <div className="border-t border-line pt-1" role="menu">
          <button role="menuitem" className={ITEM} onClick={() => { setOpen(false); setPicker(true); }}>
            <Users size={15} className="text-ink-soft" /> Switch user
          </button>
          <Link role="menuitem" href="/guide" onClick={() => setOpen(false)} className={ITEM}>
            <BookOpen size={15} className="text-ink-soft" /> Guide
          </Link>
          <button role="menuitem" className={ITEM} onClick={async () => { setOpen(false); await logout(); router.replace("/login"); }}>
            <LogOut size={15} className="text-ink-soft" /> Log out
          </button>
        </div>
      </Popover>
      {/* rendered on <body>: the navbar's backdrop blur would otherwise trap a fixed dialog inside it */}
      {picker && createPortal(
        <Modal wide="xl" title="Switch user" onClose={() => setPicker(false)}>
          <UserPicker onDone={() => setPicker(false)} />
        </Modal>, document.body)}
    </div>
  );
}
