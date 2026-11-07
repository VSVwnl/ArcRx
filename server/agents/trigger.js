// POST /api/agents/trigger { name } — run one of the app's agents now, through
// Informer's agent API (owner-backed fetch; the paths are allow-listed in
// informer.yaml → access.apis). In the dev servers the page calls
// /api/_agent/:name/_trigger directly instead.
export const config = { roles: ['clinician', 'admin'] };

export async function POST({ fetch, request, log }) {
  const name = String(request.body?.name || '');
  if (!/^[a-z0-9_]+$/i.test(name)) return { status: 400, body: { message: 'name is required' } };
  const appId = request.app?.id;
  if (!appId) return { status: 503, body: { message: 'Manual triggers need the Informer platform; agents still run on their events and schedule.' } };
  const list = await fetch(`apps/${appId}/agents`);
  if (list.status >= 300) {
    log.warn('agent list failed', { status: list.status });
    return { status: 503, body: { message: `Informer refused the agent list (${list.status}). Agents still run on their events and schedule.` } };
  }
  const items = Array.isArray(list.body) ? list.body : list.body?.items || list.body?.agents || [];
  const agent = items.find((a) => a.name === name || a.slug === name || a.key === name);
  if (!agent) return { status: 404, body: { message: `Agent ${name} is not deployed`, agents: items.map((a) => a.name) } };
  const event = name === 'weekly_caseload_report' ? '_cron' : '_manual';
  const res = await fetch(`apps/${appId}/agents/${agent.id}/_trigger`, { method: 'POST', body: { event, payload: {} } });
  if (res.status >= 300) return { status: 502, body: { message: `Trigger failed (${res.status})`, detail: res.body } };
  return { agent: name, trigger: event, status: 'queued', platform: res.body };
}
