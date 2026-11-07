-- ArcRx workspace schema (Postgres). One private schema per tenant.
CREATE TABLE patients (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE,                 -- maps to the Informer user (request.user.username)
    mrn           TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    condition     TEXT NOT NULL,
    surgery_date  DATE,
    clinician     TEXT NOT NULL,               -- Informer username of the treating clinician
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE exercise_plans (
    id                  SERIAL PRIMARY KEY,
    patient_id          INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    exercise_key        TEXT NOT NULL,         -- shoulder_abduction | elbow_flexion | neck_rotation | neck_lateral_flexion
    side                TEXT NOT NULL DEFAULT 'right',
    target_rom          NUMERIC(5,1) NOT NULL, -- degrees
    sets                INTEGER NOT NULL DEFAULT 3,
    reps                INTEGER NOT NULL DEFAULT 10,
    frequency_per_week  INTEGER NOT NULL DEFAULT 5,
    pain_threshold      INTEGER NOT NULL DEFAULT 5,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX exercise_plans_patient_idx ON exercise_plans (patient_id, active);

CREATE TABLE sessions (
    id                SERIAL PRIMARY KEY,
    patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    plan_id           INTEGER REFERENCES exercise_plans(id) ON DELETE SET NULL,
    exercise_key      TEXT NOT NULL,
    side              TEXT NOT NULL DEFAULT 'right',
    started_at        TIMESTAMPTZ NOT NULL,
    ended_at          TIMESTAMPTZ NOT NULL,
    reps              INTEGER NOT NULL DEFAULT 0,
    peak_rom          NUMERIC(5,1) NOT NULL,   -- best rep, degrees
    mean_rom          NUMERIC(5,1) NOT NULL,   -- mean of rep peaks, degrees
    smoothness        NUMERIC(5,1) NOT NULL,   -- 0..100 (100 = no jerk)
    compensation_pct  NUMERIC(5,1) NOT NULL,   -- % of reps with a compensation flag
    pain_score        INTEGER NOT NULL DEFAULT 0,  -- 0..10 self-report
    source            TEXT NOT NULL DEFAULT 'webcam', -- webcam | simulation
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX sessions_patient_time_idx ON sessions (patient_id, started_at DESC);

CREATE TABLE reps (
    id                  SERIAL PRIMARY KEY,
    session_id          INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    rep_index           INTEGER NOT NULL,
    peak_angle          NUMERIC(5,1) NOT NULL,
    duration_ms         INTEGER NOT NULL,
    hold_ms             INTEGER NOT NULL DEFAULT 0,
    smoothness          NUMERIC(5,1) NOT NULL,
    compensation_flags  JSONB NOT NULL DEFAULT '[]'::jsonb  -- e.g. ["trunk_lean","shoulder_hike"]
);
CREATE INDEX reps_session_idx ON reps (session_id);

CREATE TABLE alerts (
    id               SERIAL PRIMARY KEY,
    patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    session_id       INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    severity         TEXT NOT NULL,            -- low | medium | high
    kind             TEXT NOT NULL,            -- regression | pain | compensation | plateau | adherence | other
    title            TEXT NOT NULL,
    body             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'open', -- open | acknowledged | resolved
    created_by       TEXT NOT NULL DEFAULT 'agent:rehab_triage',
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at  TIMESTAMPTZ
);
CREATE INDEX alerts_status_idx ON alerts (status, created_at DESC);

CREATE TABLE progress_notes (
    id          SERIAL PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    session_id  INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    author      TEXT NOT NULL,                 -- agent:rehab_triage | clinician username
    note        TEXT NOT NULL,
    metrics     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX progress_notes_patient_idx ON progress_notes (patient_id, created_at DESC);

CREATE TABLE plan_changes (
    id          SERIAL PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    plan_id     INTEGER REFERENCES exercise_plans(id) ON DELETE SET NULL,
    change      JSONB NOT NULL,
    rationale   TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_runs (
    id             SERIAL PRIMARY KEY,
    agent          TEXT NOT NULL,
    trigger_event  TEXT NOT NULL,
    payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
    steps          JSONB NOT NULL DEFAULT '[]'::jsonb,
    status         TEXT NOT NULL DEFAULT 'completed',
    summary        TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
