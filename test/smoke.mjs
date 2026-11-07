// End-to-end smoke tests: in-memory PGlite + the real migrations, route handlers, agent
// tools and agent fallback plans. No network, no server, no API key. Run with `npm test`
// (needs Node 22.18+, which can import the .ts mirror helpers directly).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.argv[2] || resolve(import.meta.dirname, '..');
const req = createRequire(join(ROOT, 'package.json'));
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const yaml = req('js-yaml');

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; failures.push(name); console.log(`  FAIL ${name} ${detail}`); } };
const section = (t) => console.log(`\n# ${t}`);

// ---------- database ----------
section('Migrations');
const db = await PGlite.create();
for (const f of readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(ROOT, 'migrations', f), 'utf8')); ok(`apply ${f}`, true); }
  catch (e) { ok(`apply ${f}`, false, e.message); }
}
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const transaction = (fn) => db.transaction((tx) => fn({ query: async (s, p = []) => (await tx.query(s, p)).rows }));
const counts = (await query(`SELECT (SELECT count(*)::int FROM patients) p, (SELECT count(*)::int FROM sessions) s, (SELECT count(*)::int FROM reps) r`))[0];
ok('seed counts 4 patients / 96 sessions / 931 reps', counts.p === 4 && counts.s === 96 && counts.r === 931, JSON.stringify(counts));

// ---------- bag ----------
const events = [];
const platform = { version: 'dev', originMode: true };
const base = () => ({
  query, transaction, platform,
  fetch: async () => ({ status: 503, body: { message: 'no AI offline' } }),
  emit: async (event, payload) => { events.push({ event, payload }); },
  notify: async () => {}, email: async () => {}, log: Object.assign(() => {}, { info() {}, warn() {}, error() {}, debug() {} }), broadcast: async () => {},
});
const reqOf = (role, { params = {}, body = null, q = {}, username = role === 'patient' ? 'maya.chen' : 'dr.okafor' } = {}) =>
  ({ method: 'GET', params, query: q, body, headers: {}, roles: role ? [role] : [], user: { username } });
// Emulates the platform's config.roles gate (the mirror and Informer both enforce it before the handler runs).
async function call(file, method, role, opts = {}) {
  const mod = await imp(file);
  const need = mod.config?.roles;
  if (Array.isArray(need) && need.length && !need.includes(role)) return { status: 403 };
  let r;
  try { r = await mod[method]({ ...base(), request: { ...reqOf(role, opts), method } }); }
  catch (e) { return { status: 500, body: { error: e.message } }; }
  return r && typeof r.status === 'number' && 'body' in r ? r : { status: 200, body: r };
}

// ---------- assessment over time ----------
section('Trajectory assessment (seed data is absolute-dated)');
const { assessProgress } = await imp('lib/rehab.js');
const expected = { 1: 'plateau', 2: 'ready_to_progress', 3: 'regression', 4: 'non_adherent' };
const [{ latest }] = await query('SELECT MAX(started_at) AS latest FROM sessions');
const ageH = (Date.now() - new Date(latest).getTime()) / 3600000;
ok('seed is anchored to the day the migration ran (newest session < 3 days old)', ageH >= 0 && ageH < 72, `${ageH.toFixed(1)} h`);
for (const [label, now] of [['now', new Date()], ['24 h from now', new Date(Date.now() + 86400000)]]) {
  const got = {};
  for (const id of [1, 2, 3, 4]) {
    const s = await query('SELECT * FROM sessions WHERE patient_id=$1', [id]);
    const [plan] = await query('SELECT * FROM exercise_plans WHERE patient_id=$1 AND active', [id]);
    got[id] = assessProgress(s, plan, now).status;
  }
  const match = Object.entries(expected).every(([k, v]) => got[k] === v);
  ok(`statuses as designed at ${label}`, match, JSON.stringify(got));
}

// ---------- read routes + scoping ----------
section('Read routes and role scoping');
let r = await call('server/patients/index.js', 'GET', 'clinician');
const list = r.body?.patients || r.body;
ok('clinician sees 4 patients', Array.isArray(list) && list.length === 4, JSON.stringify(r.body).slice(0, 120));
r = await call('server/patients/index.js', 'GET', 'patient');
const plist = r.body?.patients || r.body;
ok('patient maya.chen sees only own record', Array.isArray(plist) && plist.length === 1 && plist[0].id === 1, r.status === 500 ? `500: ${r.body.error}` : JSON.stringify(plist?.map?.((p) => p.id)));
r = await call('server/patients/[id].js', 'GET', 'patient', { params: { id: '3' } });
ok("patient cannot read another patient's record", r.status === 403, `status ${r.status}`);
r = await call('server/patients/[id].js', 'GET', 'clinician', { params: { id: '3' } });
ok('clinician reads patient 3 record', r.status === 200 && r.body.patient?.name?.startsWith('Priya'), `status ${r.status}`);
r = await call('server/patients/[id].js', 'GET', 'clinician', { params: { id: '999' } });
ok('unknown patient → 404', r.status === 404, `status ${r.status}`);
for (const f of ['server/alerts/index.js', 'server/notes/index.js', 'server/exercises/index.js', 'server/sessions/index.js']) {
  r = await call(f, 'GET', 'clinician');
  ok(`GET ${f.replace('server/', '').replace('/index.js', '')} as clinician`, r.status === 200, `status ${r.status}`);
}
r = await call('server/caseload/index.js', 'GET', 'clinician');
ok('GET caseload as clinician', r.status === 200, `status ${r.status}`);

section('Role gates (config.roles)');
for (const [f, m, opts] of [['server/caseload/index.js', 'GET', {}], ['server/agents/runs.js', 'GET', {}], ['server/alerts/[id].js', 'PATCH', { params: { id: '1' }, body: { status: 'acknowledged' } }], ['server/plans/[id].js', 'PATCH', { params: { id: '1' }, body: { reps: 12 } }]]) {
  r = await call(f, m, 'patient', opts);
  ok(`patient blocked from ${m} ${f.replace('server/', '')}`, r.status === 403, `status ${r.status}`);
}

section('Manual agent trigger (rate limit reserves atomically)');
{
  const trig = await imp('server/agents/trigger.js');
  const fetchStub = async () => ({ status: 404, body: {} }); // no platform in the harness
  const mk = (user) => ({ ...base(), fetch: fetchStub, request: { method: 'POST', params: {}, query: {}, body: { name: 'rehab_triage' }, headers: {}, roles: ['clinician'], user, app: { id: 'app-1' } } });
  r = await trig.POST(mk(null));
  ok('trigger without identity → 401', r.status === 401, `status ${r.status}`);
  // AI configured but the platform agent list is unavailable → 503 and the slot is released.
  const aiOn = async (p) => (p === 'ai-budget' ? { status: 200, body: { configured: true } } : p === 'chat-models' ? { status: 200, body: { total: 1 } } : { status: 404, body: {} });
  r = await trig.POST({ ...mk({ id: 'u0' }), fetch: aiOn });
  ok('AI configured but agent API unavailable → 503', r.status === 503, `status ${r.status}`);
  const n0 = (await query('SELECT count(*)::int n FROM agent_triggers'))[0].n;
  ok('released reservation leaves no row', n0 === 0, `rows ${n0}`);
  // No AI model → the protocol runs in-process and the result comes back directly.
  r = await trig.POST(mk({ id: 'u1' }));
  ok('no AI model → weekly/triage protocol runs inline', r.mode === 'inline' && r.status === 'completed' && r.steps?.length > 0, JSON.stringify(r).slice(0, 160));
  await query('DELETE FROM agent_triggers');
  await query(`INSERT INTO agent_triggers (agent, requested_by) VALUES ('x','u1')`);
  r = await trig.POST(mk({ id: 'u1' }));
  ok('same person within 20 s → 429', r.status === 429, `status ${r.status}`);
  await query(`INSERT INTO agent_triggers (agent, requested_by) VALUES ('x','u2'), ('x','u3')`);
  r = await trig.POST(mk({ id: 'u4' }));
  ok('fourth run in a minute → 429', r.status === 429, `status ${r.status}`);
  await query('DELETE FROM agent_triggers');
}

// ---------- session write path ----------
section('Session validation');
const goodReps = Array.from({ length: 5 }, (_, i) => ({ rep_index: i + 1, peak_angle: 120 + i, duration_ms: 3000, hold_ms: 400, smoothness: 80, compensation_flags: i === 2 ? ['trunk_lean'] : [] }));
const good = { patient_id: 1, exercise_key: 'shoulder_abduction', side: 'right', source: 'webcam', started_at: new Date(Date.now() - 60000).toISOString(), pain_score: 2, reps: goodReps };
const bad = {
  'unknown exercise': { ...good, exercise_key: 'backflip' },
  'bad side': { ...good, side: 'up' },
  'no reps': { ...good, reps: [] },
  'angle out of range': { ...good, reps: [{ ...goodReps[0], peak_angle: 999 }] },
  'bad source': { ...good, source: 'hacker' },
};
for (const [name, body] of Object.entries(bad)) {
  r = await call('server/sessions/index.js', 'POST', 'clinician', { body });
  ok(`rejects ${name}`, r.status === 400, `status ${r.status}`);
}
events.length = 0;
r = await call('server/sessions/index.js', 'POST', 'clinician', { body: good });
ok('valid session saved', r.status === 200 && r.body.session?.session_id, `status ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
const saved = r.body.session;
const ev = events.find((e) => e.event === 'session.completed');
ok('session.completed emitted', !!ev);
const nReps = (await query('SELECT count(*)::int n FROM reps WHERE session_id=$1', [saved?.session_id]))[0].n;
ok('5 reps persisted', nReps === 5, `got ${nReps}`);
r = await call('server/sessions/index.js', 'POST', 'patient', { body: { ...good, patient_id: 3 } });
ok("patient cannot save a session for another patient", r.status === 403 || (r.status === 200 && r.body.session?.patient_id === 1), `status ${r.status} patient_id ${r.body?.session?.patient_id}`);

// ---------- agents ----------
section('Agents (deterministic fallback plans, real tools)');
const { runFallbackPlan } = await imp('dev/fallback-plan.ts');
async function runAgent(name, payload) {
  const def = yaml.load(readFileSync(join(ROOT, 'agents', `${name}.yaml`), 'utf8'));
  const tools = {};
  for (const t of def.tools) { const m = await imp(`tools/${t}.js`); tools[t] = (args) => m.handler({ args, run: { agentName: name }, ...base() }); }
  return runFallbackPlan({ plan: def.fallback, payload, tools, log: () => {} });
}
const before = (await query('SELECT (SELECT count(*)::int FROM alerts) a, (SELECT count(*)::int FROM progress_notes) n'))[0];
let out = await runAgent('rehab_triage', ev?.payload || { patient_id: 1, session_id: saved?.session_id });
const toolNames = out.steps.filter((s) => s.type === 'tool_call').map((s) => s.toolCalls[0].name);
const errs = out.steps.filter((s) => s.type === 'tool_call' && s.toolCalls[0].result?.error);
ok('rehab_triage ran tools without errors', toolNames.length >= 3 && errs.length === 0, `${toolNames.join(',')} ${JSON.stringify(errs.map((e) => e.toolCalls[0].result))}`);
const after = (await query('SELECT (SELECT count(*)::int FROM alerts) a, (SELECT count(*)::int FROM progress_notes) n'))[0];
ok('rehab_triage wrote a progress note', after.n === before.n + 1, JSON.stringify({ before, after }));
console.log(`    summary: ${out.text.slice(0, 160)}`);
for (const pid of [2, 3, 4]) {
  out = await runAgent('rehab_triage', { patient_id: pid });
  const e = out.steps.filter((s) => s.type === 'tool_call' && s.toolCalls[0].result?.error);
  ok(`rehab_triage on patient ${pid} clean`, e.length === 0, JSON.stringify(e.map((x) => x.toolCalls[0].result)));
}
out = await runAgent('weekly_caseload_report', {});
ok('weekly_caseload_report flags Tomás', /Tom/.test(JSON.stringify(out.steps)), out.text.slice(0, 160));

section('In-process triage when the install has no AI model');
{
  const { runRehabTriage, runWeeklyReport } = await imp('lib/triage.js');
  const bag = { ...base(), fetch: async (p) => (p === 'ai-budget' ? { status: 200, body: { configured: false } } : { status: 404, body: {} }) };
  const [s3] = await query('SELECT * FROM sessions WHERE patient_id = 3 ORDER BY started_at DESC LIMIT 1');
  const alertsBefore = (await query('SELECT count(*)::int n FROM alerts WHERE patient_id = 3'))[0].n;
  const out3 = await runRehabTriage(bag, { patient_id: 3, session_id: s3.id, exercise_key: s3.exercise_key, side: s3.side, reps: s3.reps, peak_rom: Number(s3.peak_rom), smoothness: Number(s3.smoothness), compensation_pct: Number(s3.compensation_pct), pain_score: s3.pain_score });
  const names3 = out3.steps.filter((s) => s.type === 'tool_call').map((s) => s.toolCalls[0].name);
  ok('regression patient → history, assess, high alert, note', names3.join(',') === 'get_patient_history,assess_progress,create_alert,write_progress_note', names3.join(','));
  const alertCall = out3.steps.find((s) => s.toolCalls?.[0].name === 'create_alert').toolCalls[0];
  ok('alert is high severity regression (deduplicated against the seeded one)', alertCall.args.severity === 'high' && alertCall.args.kind === 'regression' && alertCall.result.alert_id, JSON.stringify(alertCall.result));
  const alertsAfter = (await query('SELECT count(*)::int n FROM alerts WHERE patient_id = 3'))[0].n;
  ok('no duplicate open alert created', alertsAfter === alertsBefore, `${alertsBefore} → ${alertsAfter}`);
  const audit = (await query('SELECT count(*)::int n FROM agent_activity WHERE run_key = $1', [out3.id]))[0].n;
  ok('inline run wrote one audit row per tool call', audit === 4, `rows ${audit}`);
  // Maya (plateau) → plan progression. Read the plan fresh: earlier sections already progressed it once.
  const [s1] = await query('SELECT * FROM sessions WHERE patient_id = 1 ORDER BY started_at DESC LIMIT 1');
  const [plan1] = await query('SELECT target_rom, reps FROM exercise_plans WHERE patient_id = 1 AND active');
  const out1 = await runRehabTriage(bag, { patient_id: 1, session_id: s1.id, exercise_key: s1.exercise_key, side: s1.side, reps: s1.reps, peak_rom: Number(s1.peak_rom), smoothness: Number(s1.smoothness), compensation_pct: Number(s1.compensation_pct), pain_score: s1.pain_score });
  const adj = out1.steps.find((s) => s.toolCalls?.[0].name === 'adjust_plan')?.toolCalls[0];
  const [plan1b] = await query('SELECT target_rom, reps FROM exercise_plans WHERE patient_id = 1 AND active');
  ok('plateau patient → plan progressed +5° / +1 rep', adj?.result?.changed && Number(plan1b.target_rom) === Number(plan1.target_rom) + 5 && plan1b.reps === plan1.reps + 1, JSON.stringify({ from: plan1, to: plan1b, adj: adj?.result, summary: out1.summary }));
  const wk = await runWeeklyReport(bag);
  ok('weekly report inline flags Tomás', /Tom/.test(JSON.stringify(wk.steps)) && /low adherence: 1/.test(wk.summary), wk.summary);

  // The session route runs it itself on a non-dev platform without AI.
  const mod = await imp('server/sessions/index.js');
  const prodBag = { ...bag, platform: { version: '2026.2.0', originMode: true } };
  r = await mod.POST({ ...prodBag, request: { ...reqOf('clinician', { body: { ...good, patient_id: 4 } }), method: 'POST' } });
  const steps = r?.triage?.steps || [];
  ok('session POST on a platform without AI returns the inline triage run', steps.some((s) => s.toolCalls?.[0].name === 'write_progress_note'), JSON.stringify(r?.triage || r).slice(0, 200));
  r = await mod.POST({ ...prodBag, fetch: async (p) => ({ status: 200, body: p === 'chat-models' ? { total: 1 } : { configured: true } }), request: { ...reqOf('clinician', { body: { ...good, patient_id: 4 } }), method: 'POST' } });
  ok('session POST with AI configured leaves triage to Informer', r?.triage === null, JSON.stringify(r?.triage));
  r = await mod.POST({ ...prodBag, fetch: async (p) => ({ status: 200, body: p === 'chat-models' ? { total: 0 } : { configured: true } }), request: { ...reqOf('clinician', { body: { ...good, patient_id: 4 } }), method: 'POST' } });
  ok('credit pool but empty model catalog → still runs triage inline', (r?.triage?.steps || []).length > 0, JSON.stringify(r?.triage).slice(0, 120));
}

section('Adding patients');
{
  const body = { name: 'Jordan Lee', condition: 'ACL reconstruction (L), week 3', exercise_key: 'elbow_flexion', side: 'left', target_rom: 120, reps: 12, sets: 3, frequency_per_week: 4, link_to_me: true, clinic_code: '2026' };
  r = await call('server/patients/index.js', 'POST', 'clinician', { body: { ...body, clinic_code: '1234' } });
  ok('wrong clinic code → 403', r.status === 403, `status ${r.status}`);
  r = await call('server/patients/index.js', 'POST', 'clinician', { body: { ...body, clinic_code: '' } });
  ok('missing clinic code → 403', r.status === 403, `status ${r.status}`);
  {
    const mod = await imp('server/patients/index.js');
    const withEnv = await mod.POST({ ...base(), env: { ARCRX_CLINIC_CODE: 'secret-9' }, request: { ...reqOf('clinician', { body: { ...body, link_to_me: false } }), method: 'POST' } });
    ok('tenant-configured code overrides the demo default', withEnv.status === 403, `status ${withEnv.status}`);
    const okEnv = await mod.POST({ ...base(), env: { ARCRX_CLINIC_CODE: 'secret-9' }, request: { ...reqOf('clinician', { body: { ...body, link_to_me: false, clinic_code: 'secret-9' } }), method: 'POST' } });
    ok('configured code accepted', okEnv.status === 201, `status ${okEnv.status}`);
  }
  r = await call('server/patients/index.js', 'POST', 'patient', { body });
  ok('patient role cannot add patients', r.status === 403, `status ${r.status}`);
  for (const [label, bad] of Object.entries({ 'short name': { ...body, name: 'J' }, 'unknown exercise': { ...body, exercise_key: 'squat' }, 'target out of range': { ...body, target_rom: 400 }, 'fractional reps': { ...body, reps: 2.5 }, 'bad date': { ...body, surgery_date: 'yesterday' } })) {
    r = await call('server/patients/index.js', 'POST', 'clinician', { body: bad });
    ok(`rejects ${label}`, r.status === 400, `status ${r.status}`);
  }
  r = await call('server/patients/index.js', 'POST', 'clinician', { body, username: 'dr.okafor' });
  ok('clinician adds a patient linked to their account', r.status === 201 && r.body.id && r.body.plan?.exercise_key === 'elbow_flexion' && r.body.patient.username === 'dr.okafor', JSON.stringify(r.body).slice(0, 160));
  const newId = r.body.id;
  r = await call('server/patients/index.js', 'POST', 'clinician', { body, username: 'dr.okafor' });
  ok('a second linked record for the same account → 409', r.status === 409, `status ${r.status}`);
  r = await call('server/patients/index.js', 'POST', 'clinician', { body: { ...body, link_to_me: false }, username: 'dr.okafor' });
  ok('an unlinked extra patient is fine', r.status === 201, `status ${r.status}`);
  r = await call('server/patients/index.js', 'GET', 'clinician');
  const added = r.body.find((p) => p.id === newId);
  ok('new patient appears in the caseload as "no sessions yet"', added && added.assessment.status === 'no_data' && added.plan?.target_rom === 120, JSON.stringify(added?.assessment?.status));
  r = await call('server/sessions/index.js', 'POST', 'clinician', { body: { ...good, patient_id: newId, exercise_key: 'elbow_flexion', side: 'left', reps: good.reps.map((x) => ({ ...x, peak_angle: 95 })) } });
  ok('first session for the new patient saves', r.status === 200 && r.body.session?.session_id, `status ${r.status}`);
  const { runRehabTriage } = await imp('lib/triage.js');
  const out = await runRehabTriage({ ...base(), fetch: async () => ({ status: 404, body: {} }) }, { ...r.body.session });
  const errs = out.steps.filter((s) => s.toolCalls?.[0].result?.error);
  ok('triage on a one-session patient runs clean and writes a note', errs.length === 0 && out.steps.some((s) => s.toolCalls?.[0].name === 'write_progress_note'), JSON.stringify(errs).slice(0, 160));

  r = await call('server/patients/[id].js', 'DELETE', 'clinician', { params: { id: String(newId) } });
  ok('clinician cannot delete a patient', r.status === 403, `status ${r.status}`);
  r = await call('server/patients/[id].js', 'DELETE', 'admin', { params: { id: '3' } });
  ok('seeded demo patients are protected from deletion', r.status === 409, `status ${r.status}`);
  r = await call('server/patients/[id].js', 'DELETE', 'admin', { params: { id: String(newId) } });
  const left = (await query('SELECT (SELECT count(*)::int FROM sessions WHERE patient_id=$1) s, (SELECT count(*)::int FROM progress_notes WHERE patient_id=$1) n, (SELECT count(*)::int FROM agent_activity WHERE patient_id=$1) a', [newId]))[0];
  ok('admin delete removes the patient and everything attached', r.status === 200 && left.s === 0 && left.n === 0 && left.a === 0, JSON.stringify({ status: r.status, left }));
}

section('Plan guard rails');
const adj = await imp('tools/adjust_plan.js');
const [p1] = await query('SELECT * FROM exercise_plans WHERE patient_id=1 AND active');
const res = await adj.handler({ args: { patient_id: 1, target_rom: Number(p1.target_rom) + 40, reps: Number(p1.reps) + 9, rationale: 'test' }, run: {}, ...base() });
const [p1b] = await query('SELECT * FROM exercise_plans WHERE id=$1', [p1.id]);
ok('agent adjust_plan clamps to ±10° / ±2 reps', Number(p1b.target_rom) - Number(p1.target_rom) <= 10 && Number(p1b.reps) - Number(p1.reps) <= 2, JSON.stringify({ from: [p1.target_rom, p1.reps], to: [p1b.target_rom, p1b.reps], res }).slice(0, 200));
r = await call('server/plans/[id].js', 'PATCH', 'clinician', { params: { id: String(p1.id) }, body: { target_rom: -50, reps: 0 } });
ok('clinician PATCH rejects nonsense values (target -50°, 0 reps)', r.status === 400, `status ${r.status} → saved target ${r.body?.target_rom} reps ${r.body?.reps}`);

// ---------- ask ----------
section('Ask your health data (rule-based path, no model)');
const askQ = async (role, question) => (await call('server/ask/index.js', 'POST', role, { body: { question } })).body;
let a = await askQ('clinician', 'Who regressed this week?');
ok('regression question names Priya', /Priya/.test(JSON.stringify(a)), JSON.stringify(a).slice(0, 160));
a = await askQ('clinician', 'Show compensation by patient');
ok('compensation question returns a table', Array.isArray(a?.table?.rows || a?.table) , JSON.stringify(a).slice(0, 160));
a = await askQ('patient', 'Show open alerts');
ok('patient alert question is scoped to own record', !/Priya|Tom|Darnell/.test(JSON.stringify(a)), JSON.stringify(a).slice(0, 200));
a = await askQ('clinician', '');
ok('empty question handled', a && typeof a === 'object');

// ---------- SQL guard ----------
section('Governed SQL guard');
const { guardReadOnlySql, runGovernedSql } = await imp('lib/ai.js');
const accept = [
  'SELECT name FROM patients',
  'SELECT p.name, avg(s.peak_rom) FROM patients p JOIN sessions s ON s.patient_id = p.id GROUP BY p.name',
  "WITH x AS (SELECT patient_id, max(peak_rom) m FROM sessions GROUP BY patient_id) SELECT * FROM x",
  'SELECT count(*) FILTER (WHERE pain_score >= 6) FROM sessions',
];
const reject = [
  'DELETE FROM patients', 'SELECT 1; DROP TABLE patients', 'SELECT * FROM pg_user', "SELECT set_config('x','y',false)",
  'SELECT current_setting(\'is_superuser\')', 'SELECT * FROM information_schema.tables', 'SELECT * FROM agent_runs',
  'SELECT /* hi */ 1 FROM patients', 'SELECT "name" FROM patients', 'SELECT query_to_xml(\'select 1\',true,true,\'\')',
];
for (const s of accept) ok(`accepts: ${s.slice(0, 50)}`, guardReadOnlySql(s).ok, guardReadOnlySql(s).reason);
for (const s of reject) ok(`rejects: ${s.slice(0, 50)}`, !guardReadOnlySql(s).ok);
let threw = false;
try { await runGovernedSql(transaction, "INSERT INTO alerts (patient_id, severity, kind, title) VALUES (1,'low','x','x')"); } catch { threw = true; }
ok('read-only transaction refuses a write even if the guard were bypassed', threw);
const rows = await runGovernedSql(transaction, guardReadOnlySql(accept[1]).sql);
ok('read-only transaction returns rows for a valid query', Array.isArray(rows) && rows.length >= 4, `rows ${rows?.length}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log('Failed: ' + failures.join(' | '));
process.exit(fail ? 1 : 0);
