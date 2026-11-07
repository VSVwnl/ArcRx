// GET /api/_server/patients/:id — full longitudinal record for one patient.
import { assessProgress, resolvePatientScope } from '../../lib/rehab.js';

export async function GET({ query, request, platform }) {
  const id = Number(request.params.id);
  const scope = await resolvePatientScope({ query, request, platform });
  if (!scope.all && scope.patientId !== id) return { status: 403, body: { message: 'Not your record' } };

  const [patient] = await query('SELECT * FROM patients WHERE id = $1', [id]);
  if (!patient) return { status: 404, body: { message: 'Patient not found' } };
  const [plan] = await query('SELECT * FROM exercise_plans WHERE patient_id = $1 AND active = TRUE ORDER BY id DESC LIMIT 1', [id]);
  const sessions = await query('SELECT * FROM sessions WHERE patient_id = $1 ORDER BY started_at DESC LIMIT 120', [id]);
  const alerts = await query('SELECT * FROM alerts WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 50', [id]);
  const notes = await query('SELECT * FROM progress_notes WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 50', [id]);
  const planChanges = await query('SELECT * FROM plan_changes WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 20', [id]);
  const lastReps = sessions.length
    ? await query('SELECT * FROM reps WHERE session_id = $1 ORDER BY rep_index', [sessions[0].id])
    : [];
  const compensation = await query(
    `SELECT s.started_at::date AS day, f.flag, COUNT(*)::int AS n
       FROM sessions s
       JOIN reps r ON r.session_id = s.id
       CROSS JOIN LATERAL jsonb_array_elements_text(r.compensation_flags) AS f(flag)
      WHERE s.patient_id = $1 AND s.started_at >= NOW() - INTERVAL '45 days'
      GROUP BY 1, 2 ORDER BY 1`,
    [id],
  );

  return {
    patient,
    plan: plan
      ? { ...plan, target_rom: Number(plan.target_rom) }
      : null,
    assessment: assessProgress(sessions, plan),
    sessions: sessions.map(numericSession),
    lastReps,
    alerts,
    notes,
    planChanges,
    compensation,
  };
}

function numericSession(s) {
  return {
    ...s,
    peak_rom: Number(s.peak_rom),
    mean_rom: Number(s.mean_rom),
    smoothness: Number(s.smoothness),
    compensation_pct: Number(s.compensation_pct),
  };
}
