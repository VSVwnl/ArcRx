// GET /api/_server/alerts?status=open — clinician alert queue.
import { resolvePatientScope, scopeClause } from '../../lib/rehab.js';

export async function GET({ query, request, platform }) {
  const scope = await resolvePatientScope({ query, request, platform });
  const params = [];
  let where = '1 = 1';
  if (request.query.status) {
    params.push(request.query.status);
    where += ` AND a.status = $${params.length}`;
  }
  where += scopeClause(scope, 'a', params);
  return query(
    `SELECT a.*, p.name AS patient_name, p.mrn
       FROM alerts a JOIN patients p ON p.id = a.patient_id
      WHERE ${where}
      ORDER BY CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.created_at DESC
      LIMIT 100`,
    params,
  );
}
