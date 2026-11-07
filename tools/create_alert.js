// Agent tool: raise a clinician alert and push-notify the treating clinician.
export const description = 'Create a clinician alert for a patient. Use severity high for regression/pain/compensation, medium for plateau, low for adherence outreach. Title must be specific and observable.';

export const schema = {
  type: 'object',
  properties: {
    patient_id: { type: 'integer' },
    session_id: { type: ['integer', 'null'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
    kind: { type: 'string', enum: ['regression', 'pain', 'compensation', 'plateau', 'adherence', 'other'] },
    title: { type: 'string', description: 'One line, at most 80 characters' },
    body: { type: 'string', description: 'What was measured and the suggested action, 1–3 sentences' },
  },
  required: ['patient_id', 'severity', 'kind', 'title', 'body'],
};

export async function handler({ args, query, emit, notify, run, log }) {
  const [patient] = await query('SELECT id, name, clinician FROM patients WHERE id = $1', [Number(args.patient_id)]);
  if (!patient) return { error: `No patient with id ${args.patient_id}` };
  // Do not stack duplicate open alerts of the same kind for the same patient.
  const [dup] = await query(`SELECT id FROM alerts WHERE patient_id = $1 AND kind = $2 AND status = 'open' AND created_at >= NOW() - INTERVAL '2 days' LIMIT 1`, [patient.id, args.kind]);
  if (dup) return { alert_id: dup.id, deduplicated: true };
  const [alert] = await query(
    `INSERT INTO alerts (patient_id, session_id, severity, kind, title, body, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [patient.id, args.session_id ?? null, args.severity, args.kind, String(args.title).slice(0, 120), String(args.body), `agent:${run?.agentName || 'rehab_triage'}`],
  );
  await emit('alert.created', { alert_id: alert.id, patient_id: patient.id, severity: alert.severity, kind: alert.kind, title: alert.title });
  try {
    await notify(patient.clinician, `ArcRx ${alert.severity} alert — ${patient.name}: ${alert.title}`);
  } catch (err) {
    log.warn('notify failed', { message: err.message });
  }
  return { alert_id: alert.id, severity: alert.severity, title: alert.title };
}
