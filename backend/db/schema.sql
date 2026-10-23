-- Argus schema (PostgreSQL 14+). Plain SQL, no ORM.
-- `pnpm db:init` drops and recreates everything in the public schema.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
DROP SCHEMA IF EXISTS snapshot CASCADE;

-- Calendar date in India Standard Time. Deadlines are compared as IST dates.
CREATE FUNCTION ist_date(ts timestamptz) RETURNS date AS $$
    SELECT (ts AT TIME ZONE 'Asia/Kolkata')::date
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------- platform clock
-- One row. All deadline logic reads `sim_now` from here, never the system time.
CREATE TABLE platform_clock (
    id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    sim_now         timestamptz NOT NULL,
    seed_now        timestamptz NOT NULL,
    last_tick_sim   timestamptz,
    last_tick_wall  timestamptz
);

-- ---------------------------------------------------------------- people and places
CREATE TABLE regions (
    id    serial PRIMARY KEY,
    code  text NOT NULL UNIQUE,
    name  text NOT NULL
);

CREATE TABLE institutions (
    id               serial PRIMARY KEY,
    code             text NOT NULL UNIQUE,
    name             text NOT NULL,
    region_id        int NOT NULL REFERENCES regions(id),
    city             text NOT NULL,
    kind             text NOT NULL,
    established_year int NOT NULL
);

CREATE TABLE users (
    id              serial PRIMARY KEY,
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    role            text NOT NULL CHECK (role IN ('institution', 'official', 'committee')),
    designation     text NOT NULL,
    official_kind   text CHECK (official_kind IN ('regional', 'bureau')),
    rank            int,                     -- officials: 1 regional officer, 2 regional director, 3 bureau
    committee_kind  text CHECK (committee_kind IN ('EVC', 'SAC')),
    region_id       int REFERENCES regions(id),
    institution_id  int REFERENCES institutions(id),
    email           text NOT NULL,
    phone           text NOT NULL,
    phone_valid     boolean NOT NULL DEFAULT true,
    featured        boolean NOT NULL DEFAULT false,
    CHECK ((role = 'institution') = (institution_id IS NOT NULL)),
    CHECK ((role = 'official') = (official_kind IS NOT NULL)),
    CHECK ((role = 'committee') = (committee_kind IS NOT NULL))
);

-- ---------------------------------------------------------------- rules (configuration, editable on the Rules page)
CREATE TABLE sla_rules (
    code         text PRIMARY KEY,
    label        text NOT NULL,
    days         int NOT NULL CHECK (days BETWEEN 1 AND 365),
    waits_on     text NOT NULL CHECK (waits_on IN ('aicte', 'institution', 'committee')),
    description  text NOT NULL DEFAULT ''
);

CREATE TABLE stages (
    code        text PRIMARY KEY,
    name        text NOT NULL,
    actor       text NOT NULL CHECK (actor IN ('official', 'committee')),
    sla_code    text NOT NULL REFERENCES sla_rules(code),
    sort        int NOT NULL,
    description text NOT NULL DEFAULT ''
);

CREATE TABLE routes (
    code        text PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL DEFAULT ''
);

CREATE TABLE route_stages (
    route_code  text NOT NULL REFERENCES routes(code) ON DELETE CASCADE,
    seq         int NOT NULL CHECK (seq >= 1),
    stage_code  text NOT NULL REFERENCES stages(code),
    PRIMARY KEY (route_code, seq)
);

CREATE TABLE application_types (
    code        text PRIMARY KEY,
    name        text NOT NULL,
    route_code  text NOT NULL REFERENCES routes(code),
    description text NOT NULL DEFAULT ''
);

-- Reminder and overdue alert offsets, in days relative to the due date.
-- kind 'reminder' uses offset <= 0, kind 'overdue' uses offset >= 1.
CREATE TABLE reminder_rules (
    id              serial PRIMARY KEY,
    entity_type     text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('reminder', 'overdue')),
    offset_days     int NOT NULL,
    template_code   text NOT NULL,
    active          boolean NOT NULL DEFAULT true,
    effective_from  date NOT NULL,
    UNIQUE (entity_type, kind, offset_days),
    CHECK ((kind = 'reminder' AND offset_days <= 0) OR (kind = 'overdue' AND offset_days >= 1))
);

CREATE TABLE escalation_levels (
    level   int PRIMARY KEY CHECK (level BETWEEN 1 AND 3),
    title   text NOT NULL,
    target  text NOT NULL CHECK (target IN ('assigned_officer', 'region_director', 'bureau_officer', 'bureau_head'))
);

CREATE TABLE escalation_rules (
    id              serial PRIMARY KEY,
    entity_type     text NOT NULL,
    level           int NOT NULL REFERENCES escalation_levels(level),
    days_after_due  int NOT NULL CHECK (days_after_due >= 1),
    active          boolean NOT NULL DEFAULT true,
    effective_from  date NOT NULL,
    UNIQUE (entity_type, level)
);

CREATE TABLE notification_templates (
    code      text PRIMARY KEY,
    label     text NOT NULL,
    subject   text NOT NULL,
    body      text NOT NULL,
    sms       text NOT NULL
);

CREATE TABLE settings (
    key          text PRIMARY KEY,
    value        jsonb NOT NULL,
    label        text NOT NULL,
    description  text NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------- documents
CREATE TABLE files (
    id              serial PRIMARY KEY,
    institution_id  int REFERENCES institutions(id),
    application_id  int,
    entity_type     text NOT NULL,
    entity_id       int NOT NULL,
    slot            text NOT NULL,
    version         int NOT NULL,
    filename        text NOT NULL,
    content_type    text NOT NULL,
    size_bytes      int NOT NULL CHECK (size_bytes <= 2097152),
    sha256          text NOT NULL,
    data            bytea NOT NULL,
    uploaded_by     int REFERENCES users(id),
    uploaded_at     timestamptz NOT NULL,
    UNIQUE (entity_type, entity_id, slot, version)
);

-- ---------------------------------------------------------------- workflow
CREATE TABLE applications (
    id               serial PRIMARY KEY,
    ref_no           text NOT NULL UNIQUE,
    institution_id   int NOT NULL REFERENCES institutions(id),
    region_id        int NOT NULL REFERENCES regions(id),
    app_type         text NOT NULL REFERENCES application_types(code),
    route_code       text NOT NULL,
    route_snapshot   text[] NOT NULL,       -- stage codes fixed at submission time
    programme        text NOT NULL,
    academic_year    text NOT NULL,
    status           text NOT NULL CHECK (status IN ('in_progress', 'decided')),
    current_stage_id int,
    submitted_at     timestamptz NOT NULL,
    submitted_by     int REFERENCES users(id),
    decided_at       timestamptz,
    decided_by       int REFERENCES users(id),
    decision         text CHECK (decision IN ('approved', 'approved_with_undertakings', 'not_approved')),
    decision_reason  text,
    demo_tag         text UNIQUE
);

CREATE TABLE application_stages (
    id               serial PRIMARY KEY,
    application_id   int NOT NULL REFERENCES applications(id),
    seq              int NOT NULL,
    stage_code       text NOT NULL REFERENCES stages(code),
    attempt          int NOT NULL DEFAULT 1,
    status           text NOT NULL CHECK (status IN ('active', 'completed', 'reverted')),
    substatus        text NOT NULL,
    assigned_to      int REFERENCES users(id),
    started_at       timestamptz NOT NULL,
    due_at           timestamptz NOT NULL,
    completed_at     timestamptz,
    completed_by     int REFERENCES users(id),
    paused_at        timestamptz,            -- set while a deficiency is open (AICTE clock paused)
    paused_seconds   bigint NOT NULL DEFAULT 0,
    remarks          text,
    UNIQUE (application_id, seq, attempt)
);
-- Deferrable so the dataset loader can insert applications before their stages.
ALTER TABLE applications ADD CONSTRAINT applications_current_stage_fk FOREIGN KEY (current_stage_id)
    REFERENCES application_stages(id) DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX ON application_stages (application_id);
CREATE INDEX ON application_stages (status, assigned_to);

CREATE TABLE deficiencies (
    id               serial PRIMARY KEY,
    application_id   int NOT NULL REFERENCES applications(id),
    stage_id         int NOT NULL REFERENCES application_stages(id),
    raised_by        int NOT NULL REFERENCES users(id),
    raised_at        timestamptz NOT NULL,
    reason           text NOT NULL CHECK (length(trim(reason)) >= 10),
    response_due_at  timestamptz NOT NULL,
    status           text NOT NULL CHECK (status IN ('open', 'responded')),
    responded_at     timestamptz,
    responded_by     int REFERENCES users(id),
    response_text    text
);
CREATE INDEX ON deficiencies (application_id);

-- ---------------------------------------------------------------- scheduling (EVC)
CREATE TABLE evc_visits (
    id                   serial PRIMARY KEY,
    application_id       int NOT NULL REFERENCES applications(id),
    stage_id             int NOT NULL REFERENCES application_stages(id),
    status               text NOT NULL CHECK (status IN ('assignment_pending', 'availability_pending', 'date_pending',
                                                         'scheduled', 'report_pending', 'report_submitted',
                                                         'reviewed', 'cancelled')),
    step_due_at          timestamptz,
    step_started_at      timestamptz,
    created_at           timestamptz NOT NULL,
    assigned_at          timestamptz,
    scheduled_at         timestamptz,
    visit_date           date,
    conducted_at         timestamptz,
    report_submitted_at  timestamptz,
    reviewed_at          timestamptz,
    reviewed_by          int REFERENCES users(id),
    review_remarks       text
);
CREATE INDEX ON evc_visits (application_id);

CREATE TABLE evc_members (
    visit_id         int NOT NULL REFERENCES evc_visits(id),
    user_id          int NOT NULL REFERENCES users(id),
    is_convenor      boolean NOT NULL DEFAULT false,
    availability     text NOT NULL DEFAULT 'pending' CHECK (availability IN ('pending', 'available', 'unavailable')),
    available_dates  date[] NOT NULL DEFAULT '{}',
    responded_at     timestamptz,
    PRIMARY KEY (visit_id, user_id)
);

CREATE TABLE visit_reports (
    id              serial PRIMARY KEY,
    visit_id        int NOT NULL UNIQUE REFERENCES evc_visits(id),
    submitted_by    int NOT NULL REFERENCES users(id),
    submitted_at    timestamptz NOT NULL,
    findings        text NOT NULL,
    recommendation  text NOT NULL CHECK (recommendation IN ('satisfactory', 'deficiencies_noted', 'not_satisfactory')),
    file_id         int REFERENCES files(id)
);

-- ---------------------------------------------------------------- committee (SAC/SHC)
CREATE TABLE committee_reviews (
    id                   serial PRIMARY KEY,
    application_id       int NOT NULL REFERENCES applications(id),
    stage_id             int NOT NULL REFERENCES application_stages(id),
    status               text NOT NULL CHECK (status IN ('pending', 'recommended', 'cancelled')),
    summary              text NOT NULL,
    summary_source       text NOT NULL CHECK (summary_source IN ('template', 'llm')),
    summary_at           timestamptz NOT NULL,
    recommendation       text CHECK (recommendation IN ('recommend_approval', 'recommend_with_undertakings',
                                                        'recommend_not_approval')),
    remarks              text,
    recommended_by       int REFERENCES users(id),
    recommended_at       timestamptz
);

CREATE TABLE committee_members (
    review_id  int NOT NULL REFERENCES committee_reviews(id),
    user_id    int NOT NULL REFERENCES users(id),
    PRIMARY KEY (review_id, user_id)
);

-- ---------------------------------------------------------------- compliance
CREATE TABLE undertakings (
    id              serial PRIMARY KEY,
    application_id  int NOT NULL REFERENCES applications(id),
    institution_id  int NOT NULL REFERENCES institutions(id),
    condition_text  text NOT NULL,
    due_at          timestamptz NOT NULL,
    status          text NOT NULL CHECK (status IN ('open', 'evidence_submitted', 'resubmission_requested', 'verified')),
    created_at      timestamptz NOT NULL,
    created_by      int REFERENCES users(id),
    closed_at       timestamptz,
    closed_by       int REFERENCES users(id)
);
CREATE INDEX ON undertakings (institution_id);

CREATE TABLE evidence_submissions (
    id              serial PRIMARY KEY,
    undertaking_id  int NOT NULL REFERENCES undertakings(id),
    file_id         int REFERENCES files(id),
    note            text NOT NULL DEFAULT '',
    submitted_by    int NOT NULL REFERENCES users(id),
    submitted_at    timestamptz NOT NULL,
    review_status   text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'accepted', 'resubmission_requested')),
    reviewed_by     int REFERENCES users(id),
    reviewed_at     timestamptz,
    review_remarks  text
);

CREATE TABLE tracked_documents (
    id                    serial PRIMARY KEY,
    institution_id        int NOT NULL REFERENCES institutions(id),
    doc_type              text NOT NULL,
    title                 text NOT NULL,
    issued_by             text NOT NULL,
    valid_from            date NOT NULL,
    expires_on            date NOT NULL,
    status                text NOT NULL CHECK (status IN ('valid', 'renewal_submitted', 'renewal_rejected')),
    file_id               int REFERENCES files(id),
    renewal_file_id       int REFERENCES files(id),
    renewal_expires_on    date,
    renewal_submitted_at  timestamptz,
    verified_at           timestamptz,
    verified_by           int REFERENCES users(id),
    rejected_at           timestamptz,
    remarks               text,
    tracked_since         timestamptz NOT NULL
);
CREATE INDEX ON tracked_documents (institution_id);

-- ---------------------------------------------------------------- alerts, escalations, notifications
CREATE TABLE alerts (
    id              serial PRIMARY KEY,
    alert_key       text NOT NULL UNIQUE,     -- idempotency: one alert per (entity, cycle, rule, offset)
    entity_type     text NOT NULL,
    entity_id       int NOT NULL,
    cycle           text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('reminder', 'overdue', 'escalation')),
    rule_id         int NOT NULL,
    offset_days     int NOT NULL,
    level           int,
    due_date        date NOT NULL,
    trigger_date    date NOT NULL,            -- the day the rule says it should fire
    fired_at        timestamptz NOT NULL,     -- simulated time it actually fired
    application_id  int,
    institution_id  int,
    region_id       int,
    title           text NOT NULL,
    message         text NOT NULL
);
CREATE INDEX ON alerts (entity_type, entity_id);

CREATE TABLE escalations (
    id              serial PRIMARY KEY,
    alert_id        int NOT NULL REFERENCES alerts(id),
    entity_type     text NOT NULL,
    entity_id       int NOT NULL,
    cycle           text NOT NULL,
    level           int NOT NULL,
    due_date        date NOT NULL,
    escalated_at    timestamptz NOT NULL,
    target_user_id  int REFERENCES users(id),
    status          text NOT NULL CHECK (status IN ('open', 'resolved')),
    resolved_at     timestamptz,
    UNIQUE (entity_type, entity_id, cycle, level)
);

CREATE TABLE notifications (
    id          serial PRIMARY KEY,
    user_id     int NOT NULL REFERENCES users(id),
    alert_id    int REFERENCES alerts(id),
    kind        text NOT NULL,
    title       text NOT NULL,
    body        text NOT NULL,
    link        text,
    created_at  timestamptz NOT NULL,
    read_at     timestamptz
);
CREATE INDEX ON notifications (user_id, read_at);

-- Simulated email / SMS delivery log. Nothing here is really sent.
CREATE TABLE outbox (
    id               serial PRIMARY KEY,
    alert_id         int REFERENCES alerts(id),
    notification_id  int REFERENCES notifications(id),
    user_id          int NOT NULL REFERENCES users(id),
    channel          text NOT NULL CHECK (channel IN ('email', 'sms')),
    address          text NOT NULL,
    subject          text NOT NULL,
    body             text NOT NULL,
    status           text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
    status_reason    text,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL
);
CREATE INDEX ON outbox (status);

-- ---------------------------------------------------------------- audit (append-only, hash-chained)
CREATE TABLE audit_log (
    id              bigint PRIMARY KEY,
    at              timestamptz NOT NULL,
    actor_id        int REFERENCES users(id),
    actor_label     text NOT NULL,
    action          text NOT NULL,
    entity_type     text NOT NULL,
    entity_id       text NOT NULL,
    application_id  int,
    details         jsonb NOT NULL DEFAULT '{}',
    prev_hash       text NOT NULL,
    hash            text NOT NULL
);
CREATE SEQUENCE audit_log_id_seq OWNED BY audit_log.id;
CREATE INDEX ON audit_log (application_id);
CREATE INDEX ON audit_log (entity_type, entity_id);
CREATE INDEX ON audit_log (action);

CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
