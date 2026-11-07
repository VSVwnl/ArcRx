-- Audit trail written by the agent tools themselves (lib/audit.js), so the
-- in-app agent console shows the same tool calls whether the agent ran on
-- Informer, in the official dev plugin, or in the offline mirror.
CREATE TABLE IF NOT EXISTS agent_activity (
    id            SERIAL PRIMARY KEY,
    run_key       TEXT NOT NULL,            -- Informer run id, or a per-trigger id in dev
    agent         TEXT,                     -- agent name when known (dev), else inferred from the trigger
    agent_id      TEXT,                     -- Informer agent uuid when known
    trigger_event TEXT,
    patient_id    INTEGER,
    session_id    INTEGER,
    tool          TEXT NOT NULL,
    args          JSONB NOT NULL DEFAULT '{}'::jsonb,
    result        JSONB,
    ok            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_activity_run_idx ON agent_activity (run_key, id);
CREATE INDEX IF NOT EXISTS agent_activity_session_idx ON agent_activity (session_id);
CREATE INDEX IF NOT EXISTS agent_activity_created_idx ON agent_activity (created_at DESC);
