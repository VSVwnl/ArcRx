// POST /api/agents/trigger { name } — run one of the app's agents now, through
// Informer's agent API (owner-backed fetch; the paths are allow-listed in
// informer.yaml → access.apis). In the dev servers the page calls
// /api/_agent/:name/_trigger directly instead.
//
// Agents already run on their events and schedule; this is a convenience for
// the console, so it is rate-limited: at most 3 manual runs per minute across
// the app and 1 per 20 s per person, recorded in agent_triggers.
export const config = { roles: ['clinician', 'admin'] };

const PER_APP_PER_MINUTE = 3;
const PER_USER_SECONDS = 20;

import { aiConfigured } from '../../lib/ai.js';
import { runTriageForLatestSessions, runWeeklyReport } from '../../lib/triage.js';

const RESERVE_SQL = `INSERT INTO agent_triggers (agent, requested_by)
     SELECT $1, $2
      WHERE (SELECT COUNT(*) FROM agent_triggers WHERE created_at > NOW() - INTERVAL '60 seconds') < $3
        AND NOT EXISTS (SELECT 1 FROM agent_triggers WHERE requested_by = $2 AND created_at > NOW() - make_interval(secs => $4))
     RETURNING id`;
const LOCK_KEY = 731200117; // app-wide advisory lock for the reservation

export async function POST({ fetch, query, transaction, emit, notify, email, crypto, platform, request, log }) {
  const name = String(request.body?.name || '');
  if (!/^[a-z0-9_]{1,64}$/i.test(name)) return { status: 400, body: { message: 'name is required' } };
  const appId = request.app?.id;

  const who = request.user?.id || request.user?.username || request.user?.email;
  if (!who) return { status: 401, body: { message: 'Sign in to run an agent.' } };

  // Reserve the slot under an app-wide advisory lock so concurrent requests are
  // serialized: the row is inserted only while both limits hold. The official
  // dev plugin has no transaction(); there the single statement is the best
  // available and nothing is queued anyway (no platform agents in dev).
  const params = [name, String(who), PER_APP_PER_MINUTE, PER_USER_SECONDS];
  const reserved = typeof transaction === 'function'
    ? await transaction(async ({ query: q }) => { await q('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]); return q(RESERVE_SQL, params); })
    : await query(RESERVE_SQL, params);
  if (!reserved.length) return { status: 429, body: { message: `Manual runs are limited to ${PER_APP_PER_MINUTE} per minute and one per ${PER_USER_SECONDS} s per person; the agents keep running on their events and schedule.` } };
  const release = () => query('DELETE FROM agent_triggers WHERE id = $1', [reserved[0].id]).catch(() => {});

  // No AI model on this install → run the protocol in-process (same tools, same audit rows).
  if (!(await aiConfigured(fetch))) {
    try {
      const bag = { query, transaction, fetch, emit, notify, email, log, crypto, platform };
      const run = name === 'weekly_caseload_report' ? await runWeeklyReport(bag) : name === 'rehab_triage' ? await runTriageForLatestSessions(bag) : null;
      if (!run) { await release(); return { status: 404, body: { message: `No in-process protocol for ${name}` } }; }
      return { agent: name, trigger: name === 'weekly_caseload_report' ? '_cron' : '_manual', ...run };
    } catch (err) {
      await release();
      return { status: 500, body: { message: err?.message || 'inline run failed' } };
    }
  }

  if (!appId) { await release(); return { status: 503, body: { message: 'Manual triggers need the Informer platform; agents still run on their events and schedule.' } }; }
  const list = await fetch(`apps/${appId}/agents`);
  if (list.status >= 300) {
    await release();
    (log?.warn || log || (() => {}))('agent list failed', { status: list.status });
    return { status: 503, body: { message: `Informer refused the agent list (${list.status}). Agents still run on their events and schedule.` } };
  }
  const items = Array.isArray(list.body) ? list.body : list.body?.items || list.body?.agents || [];
  const agent = items.find((a) => a.name === name || a.slug === name || a.key === name);
  if (!agent) { await release(); return { status: 404, body: { message: `Agent ${name} is not deployed`, agents: items.map((a) => a.name) } }; }

  const event = name === 'weekly_caseload_report' ? '_cron' : '_manual';
  const res = await fetch(`apps/${appId}/agents/${agent.id}/_trigger`, { method: 'POST', body: { event, payload: {} } });
  if (res.status >= 300) return { status: 502, body: { message: `Trigger failed (${res.status})`, detail: res.body } };
  return { agent: name, trigger: event, status: 'queued', platform: res.body };
}
