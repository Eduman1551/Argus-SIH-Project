/** Shapes of the backend payloads used by the pages. */

export interface PendencyRow {
  id: number; ref_no: string; institution: string; institution_id: number; region: string; region_id: number;
  type_name: string; route_name: string; programme: string; stage_code: string; stage_name: string;
  substatus: string; substatus_text: string; assignee: string | null; assigned_to: number | null;
  submitted: string; stage_started: string; days_in_stage: number; age_days: number;
  waiting_institution_days: number; waiting_aicte_days: number; due_date: string | null; days_to_due: number | null;
  waiting_on: "institution" | "aicte" | "committee"; sla_status: "on_track" | "due_soon" | "overdue";
  escalation_level: number | null;
  stage_due: string; stage_paused_days: number; stage_paused_now: boolean; stage_open_pause_days: number;
}

export interface OfficialDashboard {
  role: "official"; scope: string;
  totals: { cases: number; overdue: number; due_soon: number; on_track: number; waiting_on_institution: number;
    escalated: number; institution_days: number; aicte_days: number };
  avg_age_days: number; avg_institution_days: number; avg_aicte_days: number;
  by_stage: { stage: string; name: string; cases: number; overdue: number; avg_days_in_stage: number }[];
  by_region: { region_id: number; region: string; cases: number; overdue: number }[];
  ageing: { bucket: string; cases: number }[];
  bottleneck: { stage: string; name: string; cases: number; overdue: number; avg_days_in_stage: number } | null;
  unassigned: { visit_id: number | null; application_id: number; ref_no: string; institution: string; step_due_at: string }[];
  near_deadline: PendencyRow[]; overdue_list: PendencyRow[];
  compliance: Record<string, number>;
  escalations_by_level: Record<string, number>;
}

export interface Undertaking {
  id: number; application_id: number; ref_no: string; institution_id: number; institution: string; region: string;
  condition_text: string; due_at: string; due_date: string; days_to_due: number; status: string; state: string;
  escalation_level: number | null; closed_at: string | null;
  last_submission: { id: number; file_id: number | null; note: string; submitted_at: string; review_status: string;
    review_remarks: string | null; filename: string | null } | null;
  files?: import("@/components/Files").FileRow[];
}

export interface TrackedDoc {
  id: number; institution_id: number; institution: string; region: string; doc_type: string; title: string;
  issued_by: string; valid_from: string; expires_on: string; status: string; state: string; days_to_expiry: number;
  file_id: number | null; renewal_file_id: number | null; renewal_expires_on: string | null;
  renewal_submitted_at: string | null; verified_at: string | null; remarks: string | null; escalation_level: number | null;
}

export interface Member {
  user_id: number; name: string; designation: string; is_convenor: boolean; availability: string;
  available_dates: string[]; responded_at: string | null;
}

export interface Visit {
  id: number; application_id: number; ref_no: string; institution: string; city: string; region: string;
  region_id: number; status: string; category: string; step: string; step_due_at: string | null;
  days_to_due: number | null; visit_date: string | null; members: Member[]; officer: string | null;
  escalation_level: number | null; my_availability?: string; i_am_convenor?: boolean; my_action?: string | null;
}
