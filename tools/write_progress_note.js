// Agent tool: append a SOAP-style objective progress note to the patient's chart.
export const description = 'Write an objective progress note (max 120 words) for the patient, quoting measured ROM vs target, reps, smoothness, compensation and the action taken.';

export const schema = {
  type: 'object',
  properties: {
    patient_id: { type: 'integer' },
    session_id: { type: ['integer', 'null'] },
    note: { type: 'string' },
    metrics: { type: 'object', description: 'Key numbers quoted in the note', additionalProperties: true },
  },
  required: ['patient_id', 'note'],
};

export async function handler({ args, query, run }) {
  const [row] = await query(
    'INSERT INTO progress_notes (patient_id, session_id, author, note, metrics) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id, created_at',
    [Number(args.patient_id), args.session_id ?? null, `agent:${run?.agentName || 'rehab_triage'}`, String(args.note).slice(0, 1500), JSON.stringify(args.metrics || {})],
  );
  return { note_id: row.id, created_at: row.created_at };
}
