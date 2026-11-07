// Records every agent tool call in agent_activity so the clinic's agent
// console is auditable on every platform. Wrap a tool's handler:
//
//   export const handler = audited('create_alert', async ({ args, query }) => { ... });
//
// The platform's `run` bag differs by host: Informer gives
// { appId, agentId, runId, trigger: { event, payload } }, the dev mirror adds
// agentName and a per-trigger runId. Everything here is best-effort — an audit
// failure must never fail the tool.

const EVENT_TO_AGENT = { 'session.completed': 'rehab_triage', _cron: 'weekly_caseload_report', cron: 'weekly_caseload_report' };

export function describeRun(run) {
  const trigger = run?.trigger && typeof run.trigger === 'object' ? run.trigger : { event: typeof run?.trigger === 'string' ? run.trigger : null, payload: {} };
  const payload = (trigger.payload && typeof trigger.payload === 'object' ? trigger.payload : {});
  const event = trigger.event || null;
  return {
    runKey: String(run?.runId || run?.id || `local-${event || 'manual'}`),
    agent: run?.agentName || EVENT_TO_AGENT[event] || null,
    agentId: run?.agentId ? String(run.agentId) : null,
    event,
    patientId: Number.isFinite(Number(payload.patient_id)) ? Number(payload.patient_id) : null,
    sessionId: Number.isFinite(Number(payload.session_id)) ? Number(payload.session_id) : null,
  };
}

export function audited(toolName, fn) {
  return async function handler(bag) {
    let result;
    let ok = true;
    try {
      result = await fn(bag);
    } catch (err) {
      ok = false;
      result = { error: err?.message || String(err) };
    }
    if (result && typeof result === 'object' && 'error' in result) ok = false;
    try {
      const d = describeRun(bag.run);
      const args = bag.args || {};
      const patientId = d.patientId ?? (Number.isFinite(Number(args.patient_id)) ? Number(args.patient_id) : null);
      const sessionId = d.sessionId ?? (Number.isFinite(Number(args.session_id)) ? Number(args.session_id) : null);
      await bag.query(
        `INSERT INTO agent_activity (run_key, agent, agent_id, trigger_event, patient_id, session_id, tool, args, result, ok)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
        [d.runKey, d.agent, d.agentId, d.event, patientId, sessionId, toolName, JSON.stringify(args), JSON.stringify(result ?? null), ok],
      );
    } catch (err) {
      bag.log?.warn?.('agent audit failed', { tool: toolName, message: err?.message });
    }
    return result;
  };
}
