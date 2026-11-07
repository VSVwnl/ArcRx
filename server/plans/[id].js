// PATCH /api/_server/plans/:id — clinician edits a prescription; logs the change and emits plan.adjusted.
export const config = { roles: ['clinician', 'admin'] };

const EDITABLE = ['target_rom', 'sets', 'reps', 'frequency_per_week', 'pain_threshold'];
// Clinically plausible bounds; anything outside is a typo, not a prescription.
const BOUNDS = { target_rom: [1, 180], sets: [1, 10], reps: [1, 50], frequency_per_week: [1, 14], pain_threshold: [0, 10] };

export async function PATCH({ query, request, emit }) {
  const id = Number(request.params.id);
  const b = request.body || {};
  const [before] = await query('SELECT * FROM exercise_plans WHERE id = $1', [id]);
  if (!before) return { status: 404, body: { message: 'Plan not found' } };
  for (const k of EDITABLE) {
    if (b[k] === undefined || b[k] === null) continue;
    const v = Number(b[k]);
    const [lo, hi] = BOUNDS[k];
    if (!Number.isFinite(v) || v < lo || v > hi || (k !== 'target_rom' && !Number.isInteger(v))) {
      return { status: 400, body: { message: `${k} must be ${k === 'target_rom' ? 'a number' : 'a whole number'} between ${lo} and ${hi}` } };
    }
  }
  const sets = [];
  const params = [id];
  const change = {};
  for (const k of EDITABLE) {
    if (b[k] !== undefined && b[k] !== null && Number(b[k]) !== Number(before[k])) {
      params.push(Number(b[k]));
      sets.push(`${k} = $${params.length}`);
      change[k] = { from: Number(before[k]), to: Number(b[k]) };
    }
  }
  if (!sets.length) return before;
  const [after] = await query(`UPDATE exercise_plans SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
  await query('INSERT INTO plan_changes (patient_id, plan_id, change, rationale, created_by) VALUES ($1,$2,$3::jsonb,$4,$5)', [
    before.patient_id, id, JSON.stringify(change), String(b.rationale || 'Clinician adjustment'), request.user?.username || 'clinician',
  ]);
  await emit('plan.adjusted', { patient_id: before.patient_id, plan_id: id, change });
  return after;
}
