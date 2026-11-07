// GET  /api/_server/agents/runs — recent agent runs for the in-app agent console.
// POST /api/_server/agents/runs — record a run (the dev mirror posts here after a trigger;
//                                 in production Informer keeps its own run log too).
// Agent runs can contain patient telemetry, so only clinicians/admins may read or record them.
export const config = { roles: ['clinician', 'admin'] };

export async function GET({ query, request }) {
  const limit = Math.min(Number(request.query.limit || 20), 100);
  return query('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT $1', [limit]);
}

export async function POST({ query, request }) {
  const b = request.body || {};
  if (!b.agent) return { status: 400, body: { message: 'agent is required' } };
  const [row] = await query(
    'INSERT INTO agent_runs (agent, trigger_event, payload, steps, status, summary) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6) RETURNING *',
    [b.agent, b.trigger || '_manual', JSON.stringify(b.payload || {}), JSON.stringify(b.steps || []), b.status || 'completed', b.summary || null],
  );
  return row;
}
