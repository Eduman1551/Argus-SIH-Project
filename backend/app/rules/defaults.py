"""Default rule values loaded by the seed.

These are ILLUSTRATIVE ASSUMPTIONS for the prototype, not official APH figures. They live in
database tables after seeding and are edited on the Rules page; no code reads these constants
at runtime except the seed.
"""

SLA_RULES = [
    # code, label, days, waits_on, description
    ("intake", "Completeness check", 7, "aicte", "Officer checks the application is complete."),
    ("scrutiny", "Scrutiny and re-scrutiny", 21, "aicte", "Officer scrutinises documents and norms. Paused while a deficiency is open."),
    ("deficiency_response", "Institution reply to a deficiency", 15, "institution", "Time the institution has to answer a returned application."),
    ("evc_overall", "Expert Visit Committee stage", 45, "committee", "Overall time for the EVC stage. Each EVC step also has its own limit."),
    ("evc_assignment", "Assign EVC members", 7, "aicte", "Officer assigns committee members after the case reaches the EVC queue."),
    ("evc_availability", "Members confirm availability", 5, "committee", "Each assigned member confirms dates they can visit."),
    ("evc_scheduling", "Fix the visit date", 3, "aicte", "Officer fixes a visit date from the confirmed dates."),
    ("evc_report", "Submit visit report", 5, "committee", "Convenor submits the visit report after the visit."),
    ("evc_review", "Review visit report", 5, "aicte", "Officer reviews the report and moves the case on."),
    ("sac", "SAC/SHC review", 14, "committee", "Committee reviews the case summary and records a recommendation."),
    ("decision", "Decision by competent authority", 7, "aicte", "Competent authority records the decision."),
]

STAGES = [
    # code, name, actor, sla_code, sort, description
    ("intake", "Completeness check", "official", "intake", 1, "Application received and checked for completeness."),
    ("scrutiny", "Scrutiny", "official", "scrutiny", 2, "Scrutiny of documents and norms, with re-scrutiny after a reply."),
    ("evc", "Expert Visit (EVC)", "committee", "evc_overall", 3, "Expert Visit Committee visits the institution and reports."),
    ("sac", "SAC/SHC review", "committee", "sac", 4, "Standing Appellate / Hearing Committee reviews the case."),
    ("decision", "Decision", "official", "decision", 5, "Competent authority records the decision. Argus never decides."),
]

ROUTES = [
    ("ONLY_SCRUTINY", "Only scrutiny", "Desk scrutiny, no visit.", ["intake", "scrutiny", "decision"]),
    ("SCRUTINY_EVC", "Scrutiny + EVC", "Desk scrutiny followed by an expert visit.", ["intake", "scrutiny", "evc", "decision"]),
    ("EVC_SAC", "EVC + SAC/SHC", "Expert visit followed by committee review.", ["intake", "evc", "sac", "decision"]),
    ("ONLY_EVC", "Only EVC", "Expert visit without desk scrutiny.", ["intake", "evc", "decision"]),
    ("SCRUTINY_EVC_SAC", "Scrutiny + EVC + SAC/SHC", "Full route.", ["intake", "scrutiny", "evc", "sac", "decision"]),
]

APPLICATION_TYPES = [
    ("EOA", "Extension of approval (no change)", "ONLY_SCRUTINY"),
    ("NAME_CHANGE", "Change in name of institution", "ONLY_SCRUTINY"),
    ("INTAKE", "Increase in intake / new course", "SCRUTINY_EVC"),
    ("NEW", "New technical institution", "SCRUTINY_EVC_SAC"),
    ("LOCATION", "Change of site or location", "EVC_SAC"),
    ("MERGER", "Merger or conversion of institutions", "EVC_SAC"),
    ("RESTORE", "Restoration of intake", "ONLY_EVC"),
]

# entity_type -> (reminder offsets, overdue offset)
REMINDERS = {
    "stage": ([-2, 0], 1),
    "deficiency": ([-7, -2], 1),
    "evc_step": ([-2], 1),
    "undertaking": ([-30, -15, -7, -1], 1),
    "document": ([-60, -30, -7], 1),
}

ESCALATION_LEVELS = [
    (1, "L1: Regional Director", "region_director"),
    (2, "L2: Bureau Officer, Approval Bureau", "bureau_officer"),
    (3, "L3: Bureau Head", "bureau_head"),
]

# entity_type -> days after due for L1, L2, L3
ESCALATIONS = {
    "stage": [3, 7, 14],
    "deficiency": [7, 15, 30],
    "evc_step": [3, 7, 14],
    "undertaking": [7, 15, 30],
    "document": [7, 15, 30],
}

ENTITY_LABELS = {
    "stage": "Application stage (officer or committee work)",
    "deficiency": "Institution reply to a deficiency",
    "evc_step": "EVC step (assignment, availability, visit, report)",
    "undertaking": "Undertaking (time-bound condition)",
    "document": "Tracked document validity (lease and others)",
}

_R = "Reminder: {item} is due on {due_date} ({days_text})."
_O = "Overdue: {item} was due on {due_date} and is now {days_late} day(s) late."
TEMPLATES = [
    # code, label, subject, body, sms
    ("reminder.stage", "Stage reminder", "Reminder: {ref} {stage} due {due_date}", _R + " Case {ref}, {institution}.", "Argus: {ref} {stage} due {due_date}."),
    ("overdue.stage", "Stage overdue", "OVERDUE: {ref} {stage}", _O + " Case {ref}, {institution}.", "Argus: {ref} {stage} OVERDUE since {due_date}."),
    ("reminder.deficiency", "Deficiency reply reminder", "Reply due {due_date} for {ref}", _R + " Please answer the deficiency raised on {ref}.", "Argus: reply to deficiency on {ref} due {due_date}."),
    ("overdue.deficiency", "Deficiency reply overdue", "OVERDUE reply for {ref}", _O + " Your reply on {ref} has not been received.", "Argus: reply on {ref} OVERDUE."),
    ("reminder.evc_step", "EVC step reminder", "EVC reminder for {ref}: {item}", _R + " Case {ref}, {institution}.", "Argus: EVC {item} for {ref} due {due_date}."),
    ("overdue.evc_step", "EVC step overdue", "EVC DELAYED for {ref}: {item}", _O + " Case {ref}, {institution}.", "Argus: EVC {item} for {ref} DELAYED."),
    ("reminder.undertaking", "Undertaking reminder", "Undertaking due {due_date}: {institution}", _R + " Upload evidence of compliance before the due date.", "Argus: undertaking due {due_date}. Upload evidence."),
    ("overdue.undertaking", "Undertaking overdue", "OVERDUE undertaking: {institution}", _O + " Evidence of compliance has not been verified.", "Argus: undertaking OVERDUE since {due_date}."),
    ("reminder.document", "Document expiry reminder", "{item} expires {due_date}", "Reminder: {item} of {institution} expires on {due_date} ({days_text}). Upload the renewed document.", "Argus: {item} expires {due_date}. Upload renewal."),
    ("overdue.document", "Document expired", "EXPIRED: {item} of {institution}", "{item} of {institution} expired on {due_date} and no verified renewal is on record.", "Argus: {item} EXPIRED on {due_date}."),
    ("escalation", "Escalation", "Escalated to {level_title}: {item}", "{item} ({ref_or_institution}) was due on {due_date} and is {days_late} day(s) late. It has been escalated to {level_title}.", "Argus: {item} escalated to L{level}."),
    ("event.deficiency_raised", "Deficiency raised", "Application {ref} returned with a deficiency", "Your application {ref} was returned: {reason}. Please reply by {due_date}.", "Argus: {ref} returned. Reply by {due_date}."),
    ("event.deficiency_answered", "Deficiency answered", "{institution} replied on {ref}", "{institution} has replied to the deficiency on {ref}. The case is back for re-scrutiny.", "Argus: reply received on {ref}."),
    ("event.assigned", "Task assigned", "Assigned to you: {ref} {stage}", "{ref} ({institution}) is assigned to you for {stage}. Due {due_date}.", "Argus: {ref} {stage} assigned to you."),
    ("event.stage_moved", "Case moved to next stage", "{ref} moved to {stage}", "Application {ref} has moved to {stage}.", "Argus: {ref} now at {stage}."),
    ("event.decision", "Decision recorded", "Decision recorded on {ref}", "The competent authority recorded a decision on {ref}: {outcome}.", "Argus: decision recorded on {ref}."),
    ("event.evidence_submitted", "Evidence submitted", "Evidence submitted by {institution}", "{institution} uploaded evidence for an undertaking. Please verify.", "Argus: evidence awaiting verification."),
    ("event.evidence_reviewed", "Evidence reviewed", "Undertaking evidence {outcome}", "Your evidence for the undertaking was {outcome}. {reason}", "Argus: undertaking evidence {outcome}."),
    ("event.renewal_submitted", "Renewal submitted", "Renewed {item} submitted by {institution}", "{institution} uploaded a renewed {item}. Please verify.", "Argus: renewal awaiting verification."),
    ("event.renewal_reviewed", "Renewal reviewed", "Renewed {item} {outcome}", "Your renewed {item} was {outcome}. {reason}", "Argus: renewal {outcome}."),
    ("event.evc_assigned", "EVC assignment", "EVC visit assigned: {ref}", "You are assigned to the Expert Visit Committee for {ref} ({institution}). Please confirm your availability by {due_date}.", "Argus: EVC for {ref}. Confirm availability."),
    ("event.visit_scheduled", "Visit scheduled", "EVC visit fixed for {ref} on {visit_date}", "The expert visit for {ref} ({institution}) is fixed for {visit_date}.", "Argus: EVC visit {ref} on {visit_date}."),
    ("event.report_submitted", "Visit report submitted", "Visit report submitted for {ref}", "The EVC visit report for {ref} is submitted and awaits review.", "Argus: visit report for {ref} submitted."),
    ("event.committee_assigned", "SAC/SHC review assigned", "SAC/SHC review: {ref}", "{ref} ({institution}) is placed before you for SAC/SHC review. Due {due_date}.", "Argus: SAC/SHC review {ref}."),
    ("event.recommendation", "Recommendation recorded", "Committee recommendation on {ref}", "The committee recorded its recommendation on {ref}: {outcome}.", "Argus: recommendation on {ref}."),
]

SETTINGS = [
    ("due_soon_days", 3, "Due soon window (days)", "Items due within this many days show as Due soon."),
    ("expiring_soon_days", 60, "Expiring soon window (days)", "Documents expiring within this many days show as Expiring soon."),
    ("evc_due_window_days", 3, "EVC visit due window (days)", "Scheduled visits within this many days show as Due."),
    ("assumed_manual_followups_per_alert", 1, "Manual follow-ups replaced per alert (assumed)",
     "Assumption used for the Manual follow-up reduction KPI. Not a measured value."),
]
