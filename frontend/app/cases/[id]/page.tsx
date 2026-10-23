"use client";

import { useParams } from "next/navigation";
import CaseView from "@/components/case/CaseView";

/** Committee view of a SAC/SHC case: summary first, then the recommendation form. */
export default function CommitteeCasePage() {
  const { id } = useParams<{ id: string }>();
  return <CaseView appId={Number(id)} mode="committee" />;
}
