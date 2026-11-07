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
  notify: async () => {}, email: async () => {}, log: () => {}, broadcast: async () => {},
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
ok('read-only transaction returns rows for a valid query', Array.isArray(rows) && rows.length === 4, `rows ${rows?.length}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log('Failed: ' + failures.join(' | '));
process.exit(fail ? 1 : 0);
