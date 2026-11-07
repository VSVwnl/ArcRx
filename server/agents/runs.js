// GET /api/agents/runs — recent agent runs for the in-app agent console, rebuilt
// from the audit rows the tools write (lib/audit.js). Works identically on
// Informer and in the dev servers. Filters: ?session_id=, ?limit=.
// Runs carry patient telemetry, so only clinicians/admins may read them.
export const config = { roles: ['clinician', 'admin'] };

export async function GET({ query, request }) {
  const limit = Math.min(Math.max(Number(request.query.limit || 20), 1), 100);
  const sessionId = Number(request.query.session_id);
  // Pick the most recent run keys (optionally only runs that touched one session), then load their rows.
  const bySession = Number.isFinite(sessionId) && sessionId > 0;
  const keys = await query(
    `SELECT run_key FROM agent_activity ${bySession ? 'WHERE session_id = $2' : ''}
      GROUP BY run_key ORDER BY MAX(id) DESC LIMIT $1`,
    bySession ? [limit, sessionId] : [limit],
  );
  if (!keys.length) return [];
  const rows = await query('SELECT * FROM agent_activity WHERE run_key = ANY($1::text[]) ORDER BY id', [keys.map((k) => k.run_key)]);
  const runs = new Map();
  for (const r of rows) {
    let run = runs.get(r.run_key);
    if (!run) {
      run = { id: r.run_key, agent: r.agent || (r.agent_id ? `agent ${String(r.agent_id).slice(0, 8)}` : 'agent'), trigger_event: r.trigger_event || '_manual', patient_id: r.patient_id, session_id: r.session_id, status: 'completed', summary: null, steps: [], created_at: r.created_at, ended_at: r.created_at };
      runs.set(r.run_key, run);
    }
    run.steps.push({ type: 'tool_call', toolCalls: [{ name: r.tool, args: r.args, result: r.result }] });
    run.ended_at = r.created_at;
    if (!r.ok) run.status = 'completed_with_errors';
    if (r.tool === 'write_progress_note' && r.args?.note) run.summary = String(r.args.note).slice(0, 240);
    if (r.tool === 'summarize_caseload' && r.result?.counts) {
      const c = r.result.counts;
      run.summary = `Caseload digest — regression ${c.regression ?? 0}, plateau ${c.plateau ?? 0}, low adherence ${c.non_adherent ?? 0}, ready to progress ${c.ready_to_progress ?? 0}, on track ${c.on_track ?? 0}`;
    }
    if (r.tool === 'create_alert' && r.args?.title && !run.summary) run.summary = `Alert: ${String(r.args.title).slice(0, 200)}`;
  }
  return [...runs.values()].sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at));
}
