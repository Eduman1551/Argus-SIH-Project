"use client";

import { useParams } from "next/navigation";
import CaseView from "@/components/case/CaseView";

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  return <CaseView appId={Number(id)} mode="case" />;
}
