"use client";

import { useParams } from "next/navigation";
import CaseView from "@/components/case/CaseView";
import { ErrorNote, PageSkeleton } from "@/components/ui";
import { useApi } from "@/lib/api";

/** Committee view of an EVC visit: availability, visit confirmation, report submission. */
export default function VisitPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<{ application: { id: number } }>(`/api/visits/${id}`);
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorNote error={error ?? { message: "Visit not found" }} onRetry={reload} />;
  return <CaseView appId={data.application.id} mode="visit" />;
}
