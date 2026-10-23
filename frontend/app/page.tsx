"use client";

import CommitteeCases from "@/components/home/CommitteeCases";
import InstitutionHome from "@/components/home/InstitutionHome";
import OfficialDashboard from "@/components/home/OfficialDashboard";
import { useApp } from "@/lib/store";

export default function Home() {
  const user = useApp((s) => s.user);
  if (!user) return null;
  if (user.role === "institution") return <InstitutionHome />;
  if (user.role === "committee") return <CommitteeCases />;
  return <OfficialDashboard />;
}
