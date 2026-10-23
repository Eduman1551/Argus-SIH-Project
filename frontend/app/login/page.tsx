"use client";

import { UserPicker } from "@/components/auth/UserPicker";
import { Mark } from "@/components/shell/Logo";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-[980px] py-6">
      <div className="enter mb-7 text-center">
        <div className="mb-3 inline-flex"><Mark size={40} /></div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Sign in to Argus</h1>
        <p className="mx-auto mt-1.5 max-w-xl text-[14.5px] text-ink-soft">
          Tracks AICTE approval cases, deadlines and undertakings, and reminds people before anything slips.
        </p>
      </div>
      <p className="mb-3 text-[13px] text-ink-soft">This is a demo: pick a user to sign in as.</p>
      <UserPicker />
      <p className="mt-8 text-center text-[12px] text-ink-soft">Prototype, not an official AICTE system. All data is synthetic.</p>
    </div>
  );
}
