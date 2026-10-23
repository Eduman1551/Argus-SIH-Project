"use client";

import CommitteeCases from "@/components/home/CommitteeCases";
import { ErrorNote } from "@/components/ui";
import { useApp } from "@/lib/store";

export default function MyCases() {
  const user = useApp((s) => s.user);
  if (!user) return null;
  if (user.role !== "committee") return <ErrorNote error={{ message: "My cases is the committee members' page. Switch to a committee user to see it." }} />;
  return <CommitteeCases />;
}
