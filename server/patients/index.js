// GET /api/_server/patients — caseload with each patient's active plan and trajectory assessment.
import { assessProgress, resolvePatientScope } from '../../lib/rehab.js';

export async function GET({ query, request, platform }) {
  const scope = await resolvePatientScope({ query, request, platform });
  const params = [];
  // patients is keyed by id; scopeClause targets tables that carry a patient_id column.
  let where = '';
  if (!scope.all) { params.push(scope.patientId); where = ` AND p.id = $${params.length}`; }
  const patients = await query(
    `SELECT p.*, ep.id AS plan_id, ep.exercise_key, ep.side, ep.target_rom, ep.sets, ep.reps AS plan_reps,
            ep.frequency_per_week, ep.pain_threshold
       FROM patients p
       LEFT JOIN exercise_plans ep ON ep.patient_id = p.id AND ep.active = TRUE
      WHERE 1 = 1${where}
      ORDER BY p.name`,
    params,
  );
  const sessions = await query(
    `SELECT s.patient_id, s.started_at, s.peak_rom, s.compensation_pct, s.pain_score, s.smoothness
       FROM sessions s
      WHERE s.started_at >= NOW() - INTERVAL '60 days'
      ORDER BY s.started_at`,
  );
  const openAlerts = await query(
    `SELECT patient_id, COUNT(*)::int AS n, MAX(severity) AS top FROM alerts WHERE status = 'open' GROUP BY patient_id`,
  );
  const alertMap = Object.fromEntries(openAlerts.map((a) => [a.patient_id, a]));
  return patients.map((p) => {
    const hist = sessions.filter((s) => s.patient_id === p.id);
    const assessment = assessProgress(hist, p);
    return {
      id: p.id,
      name: p.name,
      mrn: p.mrn,
      username: p.username,
      condition: p.condition,
      surgery_date: p.surgery_date,
      clinician: p.clinician,
      plan: p.plan_id
        ? {
            id: p.plan_id,
            exercise_key: p.exercise_key,
            side: p.side,
            target_rom: Number(p.target_rom),
            sets: p.sets,
            reps: p.plan_reps,
            frequency_per_week: p.frequency_per_week,
            pain_threshold: p.pain_threshold,
          }
        : null,
      assessment,
      openAlerts: alertMap[p.id]?.n ?? 0,
      lastSession: hist.length ? hist[hist.length - 1].started_at : null,
      sparkline: hist.slice(-14).map((s) => Number(s.peak_rom)),
    };
  });
}
