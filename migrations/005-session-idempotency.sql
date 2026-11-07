-- Idempotent session saves: the page sends one client_ref per session and reuses
-- it on retries, so a retry after a lost response returns the existing row
-- instead of writing a duplicate.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_client_ref_idx ON sessions (patient_id, client_ref) WHERE client_ref IS NOT NULL;
