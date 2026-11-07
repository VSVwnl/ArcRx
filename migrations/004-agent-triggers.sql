-- Manual "Run now" requests from the agent console, kept so the route can
-- rate-limit them (the agents already run on their events and schedule).
CREATE TABLE IF NOT EXISTS agent_triggers (
    id           SERIAL PRIMARY KEY,
    agent        TEXT NOT NULL,
    requested_by TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_triggers_created_idx ON agent_triggers (created_at DESC);
