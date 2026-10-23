/** Plain-English labels for codes coming from the backend. */

export const ACTION_TEXT: Record<string, string> = {
  "application.submitted": "Application submitted",
  "application.routed": "Moved to the next stage",
  "stage.started": "Stage started",
  "stage.assigned": "Assigned",
  "stage.completed": "Stage completed",
  "stage.reverted": "Sent back to an earlier stage",
  "deficiency.raised": "Returned with a deficiency",
  "deficiency.responded": "Institution replied",
  "evc.queued": "Placed in the EVC queue",
  "evc.members_assigned": "EVC members assigned",
  "evc.availability_given": "Member confirmed availability",
  "evc.availability_complete": "All members confirmed",
  "evc.scheduled": "Visit date fixed",
  "evc.rescheduled": "Visit rescheduled",
  "evc.conducted": "Visit conducted",
  "evc.report_submitted": "Visit report submitted",
  "evc.report_reviewed": "Visit report reviewed",
  "committee.review_opened": "Placed before SAC/SHC",
  "committee.members_assigned": "Committee members assigned",
  "committee.summary_generated": "Case summary drafted",
  "committee.recommended": "Committee recommendation recorded",
  "decision.recorded": "Decision recorded by the competent authority",
  "undertaking.created": "Undertaking created",
  "undertaking.evidence_submitted": "Evidence submitted",
  "undertaking.verified": "Evidence verified, undertaking closed",
  "undertaking.resubmission_requested": "Evidence returned for resubmission",
  "document.uploaded": "File uploaded",
  "document.tracking_started": "Document tracking started",
  "document.renewal_submitted": "Renewal submitted",
  "document.renewal_verified": "Renewal verified",
  "document.renewal_rejected": "Renewal not accepted",
  "alert.fired": "Automatic alert sent",
  "escalation.raised": "Escalated",
  "escalation.resolved": "Escalation resolved",
  "outbox.delivery_updated": "Simulated delivery updated",
  "rule.changed": "Rule changed",
  "clock.advanced": "Simulated clock advanced",
  "demo.reset": "Demo data reset",
  "dataset.created": "Synthetic dataset created",
};

export const STAGE_NAME: Record<string, string> = {
  intake: "Completeness check",
  scrutiny: "Scrutiny",
  evc: "Expert Visit (EVC)",
  sac: "SAC/SHC review",
  decision: "Decision",
};

export const DECISION_TEXT: Record<string, string> = {
  approved: "Approved",
  approved_with_undertakings: "Approved with undertakings",
  not_approved: "Not approved",
};

export const RECOMMENDATION_TEXT: Record<string, string> = {
  recommend_approval: "Recommend approval",
  recommend_with_undertakings: "Recommend approval with undertakings",
  recommend_not_approval: "Recommend not to approve",
};

export const REPORT_OUTCOME_TEXT: Record<string, string> = {
  satisfactory: "Satisfactory",
  deficiencies_noted: "Deficiencies noted",
  not_satisfactory: "Not satisfactory",
};

export const ENTITY_TEXT: Record<string, string> = {
  stage: "Application stage",
  deficiency: "Deficiency reply",
  evc_step: "EVC step",
  undertaking: "Undertaking",
  document: "Document validity",
};

export const WAITING_TEXT: Record<string, string> = {
  institution: "Institution",
  aicte: "AICTE officer",
  committee: "Committee",
};

export const EVC_CATEGORY: Record<string, string> = {
  queue: "In queue",
  coordinating: "Coordinating dates",
  scheduled: "Scheduled",
  due: "Visit due",
  delayed: "Delayed",
  report: "Report stage",
  completed: "Completed",
};
