// Agent tool: progress or hold a prescription, with an audit trail.
export const description = 'Adjust the patient\'s active exercise plan (target_rom in degrees, reps, sets, frequency_per_week). Keep changes modest (target +5..10°, reps +1..2). Always give a rationale.';

export const schema = {
  type: 'object',
  properties: {
    patient_id: { type: 'integer' },
    target_rom: { type: ['number', 'null'] },
    reps: { type: ['integer', 'null'] },
    sets: { type: ['integer', 'null'] },
    frequency_per_week: { type: ['integer', 'null'] },
    rationale: { type: 'string' },
  },
  required: ['patient_id', 'rationale'],
};

const EDITABLE = ['target_rom', 'reps', 'sets', 'frequency_per_week'];

export async function handler({ args, query, emit, run }) {
  const [plan] = await query('SELECT * FROM exercise_plans WHERE patient_id = $1 AND active = TRUE ORDER BY id DESC LIMIT 1', [Number(args.patient_id)]);
  if (!plan) return { error: 'No active plan for this patient' };
  const sets = [];
  const params = [plan.id];
  const change = {};
  for (const k of EDITABLE) {
    if (args[k] == null) continue;
    let v = Number(args[k]);
    // Guard rails: an agent may only progress modestly.
    if (k === 'target_rom') v = Math.min(Number(plan.target_rom) + 10, Math.max(Number(plan.target_rom) - 10, v));
    if (k === 'reps') v = Math.min(plan.reps + 2, Math.max(plan.reps - 2, Math.round(v)));
    if (k === 'sets') v = Math.min(plan.sets + 1, Math.max(plan.sets - 1, Math.round(v)));
    if (k === 'frequency_per_week') v = Math.min(7, Math.max(1, Math.round(v)));
    if (v === Number(plan[k])) continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
    change[k] = { from: Number(plan[k]), to: v };
  }
  if (!sets.length) return { changed: false, plan_id: plan.id };
  const [after] = await query(`UPDATE exercise_plans SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
  await query('INSERT INTO plan_changes (patient_id, plan_id, change, rationale, created_by) VALUES ($1,$2,$3::jsonb,$4,$5)', [
    plan.patient_id, plan.id, JSON.stringify(change), String(args.rationale), `agent:${run?.agentName || 'rehab_triage'}`,
  ]);
  await emit('plan.adjusted', { patient_id: plan.patient_id, plan_id: plan.id, change });
  return { changed: true, plan_id: plan.id, change, plan: { ...after, target_rom: Number(after.target_rom) } };
}
