// Agent tool: deterministic trajectory assessment (shared with the dashboard).
import { assessProgress } from '../lib/rehab.js';

export const description = 'Assess a patient\'s rehab trajectory from their recent sessions versus their plan. Returns a status (on_track | ready_to_progress | plateau | regression | non_adherent | no_data), reasons, recommendations, flags and metrics.';

export const schema = {
  type: 'object',
  properties: { patient_id: { type: 'integer', description: 'The patient id' } },
  required: ['patient_id'],
};

export async function handler({ args, query }) {
  const id = Number(args.patient_id);
  const [plan] = await query('SELECT * FROM exercise_plans WHERE patient_id = $1 AND active = TRUE ORDER BY id DESC LIMIT 1', [id]);
  const sessions = await query(`SELECT * FROM sessions WHERE patient_id = $1 AND started_at >= NOW() - INTERVAL '60 days' ORDER BY started_at DESC`, [id]);
  return assessProgress(sessions, plan);
}
