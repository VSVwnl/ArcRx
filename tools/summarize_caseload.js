// Agent tool: one row per patient with trajectory status and adherence, for the weekly digest.
import { assessProgress, STATUS_LABELS } from '../lib/rehab.js';

export const description = 'Summarise every patient on the caseload: trajectory status, latest peak ROM vs target, adherence % over the last 7 days, pain and compensation.';

export const schema = {
  type: 'object',
  properties: { clinician: { type: ['string', 'null'], description: 'Restrict to one clinician username' } },
};

export async function handler({ args, query }) {
  const params = [];
  const where = args.clinician ? (params.push(args.clinician), ' WHERE p.clinician = $1') : '';
  const patients = await query(
    `SELECT p.id, p.name, p.condition, p.clinician, ep.exercise_key, ep.target_rom, ep.frequency_per_week, ep.pain_threshold
       FROM patients p LEFT JOIN exercise_plans ep ON ep.patient_id = p.id AND ep.active = TRUE${where} ORDER BY p.name`,
    params,
  );
  const sessions = await query(`SELECT * FROM sessions WHERE started_at >= NOW() - INTERVAL '60 days' ORDER BY started_at`);
  const rows = patients.map((p) => {
    const a = assessProgress(sessions.filter((s) => s.patient_id === p.id), p);
    return {
      patient_id: p.id,
      name: p.name,
      condition: p.condition,
      exercise_key: p.exercise_key,
      status: a.status,
      status_label: STATUS_LABELS[a.status],
      latest_peak: a.metrics.latestPeak,
      target: a.metrics.target,
      pct_of_target: a.metrics.pctOfTarget,
      adherence: a.metrics.adherence,
      sessions_7d: a.metrics.sessionsLast7,
      prescribed_per_week: a.metrics.prescribedPerWeek,
      pain: a.metrics.pain,
      compensation_pct: a.metrics.compensationPct,
      reasons: a.reasons,
    };
  });
  const counts = { on_track: 0, ready_to_progress: 0, plateau: 0, regression: 0, non_adherent: 0, no_data: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return { generated_at: new Date().toISOString(), counts, patients: rows };
}
