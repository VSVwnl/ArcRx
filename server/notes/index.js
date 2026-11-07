// GET  /api/_server/notes?patient_id=…  — progress notes (agent and clinician authored)
// POST /api/_server/notes               — clinician adds a note
import { resolvePatientScope, scopeClause } from '../../lib/rehab.js';

export async function GET({ query, request, platform }) {
  const scope = await resolvePatientScope({ query, request, platform });
  const params = [];
  let where = '1 = 1';
  if (request.query.patient_id) {
    params.push(Number(request.query.patient_id));
    where += ` AND n.patient_id = $${params.length}`;
  }
  where += scopeClause(scope, 'n', params);
  return query(
    `SELECT n.*, p.name AS patient_name FROM progress_notes n JOIN patients p ON p.id = n.patient_id
      WHERE ${where} ORDER BY n.created_at DESC LIMIT 100`,
    params,
  );
}

export async function POST({ query, request }) {
  if (!(request.roles || []).some((r) => r === 'clinician' || r === 'admin')) return { status: 403, body: { message: 'Clinicians only' } };
  const b = request.body || {};
  if (!b.patient_id || !b.note) return { status: 400, body: { message: 'patient_id and note are required' } };
  const [row] = await query(
    'INSERT INTO progress_notes (patient_id, session_id, author, note, metrics) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *',
    [Number(b.patient_id), b.session_id ?? null, request.user?.username || 'clinician', String(b.note), JSON.stringify(b.metrics || {})],
  );
  return row;
}
