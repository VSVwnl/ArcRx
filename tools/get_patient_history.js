// Agent tool: patient, active plan and recent sessions.
import { audited } from '../lib/audit.js';
export const description = 'Fetch a patient record, their active exercise plan and their exercise sessions from the last N days (default 30), newest first.';

export const schema = {
  type: 'object',
  properties: {
    patient_id: { type: 'integer', description: 'The patient id' },
    days: { type: 'integer', description: 'How many days of history to return', default: 30 },
  },
  required: ['patient_id'],
};

export const handler = audited('get_patient_history', async function handler({ args, query }) {
  const days = Math.min(Math.max(Number(args.days || 30), 1), 365);
  const [patient] = await query('SELECT id, name, mrn, condition, surgery_date, clinician FROM patients WHERE id = $1', [Number(args.patient_id)]);
  if (!patient) return { error: `No patient with id ${args.patient_id}` };
  const [plan] = await query('SELECT * FROM exercise_plans WHERE patient_id = $1 AND active = TRUE ORDER BY id DESC LIMIT 1', [patient.id]);
  const sessions = await query(
    `SELECT id, exercise_key, side, started_at, reps, peak_rom, mean_rom, smoothness, compensation_pct, pain_score, source
       FROM sessions WHERE patient_id = $1 AND started_at >= NOW() - ($2 || ' days')::interval ORDER BY started_at DESC LIMIT 60`,
    [patient.id, String(days)],
  );
  const openAlerts = await query(`SELECT id, severity, kind, title, created_at FROM alerts WHERE patient_id = $1 AND status = 'open' ORDER BY created_at DESC`, [patient.id]);
  return {
    patient,
    plan: plan ? { ...plan, target_rom: Number(plan.target_rom) } : null,
    sessions: sessions.map((s) => ({ ...s, peak_rom: Number(s.peak_rom), mean_rom: Number(s.mean_rom), smoothness: Number(s.smoothness), compensation_pct: Number(s.compensation_pct) })),
    openAlerts,
  };
});
