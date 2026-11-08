// In-process execution of the two agent protocols with the real tool handlers.
//
// Informer runs the agents declared in informer.yaml through an LLM. On a
// tenant with no AI model configured (GET /api/ai-budget → configured: false)
// nothing would run, so the session route and the console fall back to this
// deterministic implementation of the same protocol — the same rules the
// offline mirror executes from agents/*.yaml, calling the same tools, which
// write the same audit rows (lib/audit.js). What a judge sees without a model
// is what the agent does with one.
import * as getPatientHistory from '../tools/get_patient_history.js';
import * as assessProgressTool from '../tools/assess_progress.js';
import * as createAlert from '../tools/create_alert.js';
import * as adjustPlan from '../tools/adjust_plan.js';
import * as writeProgressNote from '../tools/write_progress_note.js';
import * as summarizeCaseload from '../tools/summarize_caseload.js';

const TOOLS = {
  get_patient_history: getPatientHistory.handler,
  assess_progress: assessProgressTool.handler,
  create_alert: createAlert.handler,
  adjust_plan: adjustPlan.handler,
  write_progress_note: writeProgressNote.handler,
  summarize_caseload: summarizeCaseload.handler,
};

const list = (v) => (Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v));
const n0 = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v ?? ''));

async function newRunId(bag) {
  try { if (bag.crypto?.randomUUID) return await bag.crypto.randomUUID(); } catch { /* fall through */ }
  return `inline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeCaller(bag, agentName, runId, trigger) {
  const steps = [];
  const call = async (tool, args) => {
    const fn = TOOLS[tool];
    let result;
    try { result = await fn({ ...bag, args, run: { agentName, runId, trigger } }); }
    catch (err) { result = { error: err?.message || String(err) }; }
    steps.push({ type: 'tool_call', toolCalls: [{ name: tool, args, result }] });
    return result;
  };
  return { call, steps };
}

/** rehab_triage protocol for one completed session. `payload` is the session.completed payload. */
export async function runRehabTriage(bag, payload, { runId } = {}) {
  const started = Date.now();
  const id = runId || (await newRunId(bag));
  const trigger = { event: 'session.completed', payload };
  const { call, steps } = makeCaller(bag, 'rehab_triage', id, trigger);
  const pid = Number(payload.patient_id);

  const history = await call('get_patient_history', { patient_id: pid, days: 30 });
  const assessment = await call('assess_progress', { patient_id: pid });
  const a = assessment && !assessment.error ? assessment : null;
  if (!a) {
    steps.push({ type: 'text', text: 'Assessment unavailable; no action taken.' });
    return finish('Assessment unavailable', steps, id, started);
  }
  const m = a.metrics || {};
  const status = a.status;
  const base = { patient_id: pid, session_id: payload.session_id ?? null };

  if (status === 'regression') {
    await call('create_alert', { ...base, severity: 'high', kind: 'regression',
      title: `Peak ROM regressed to ${n0(m.latestPeak)}° (${n0(m.pctOfTarget)}% of target)`,
      body: `${list(a.reasons)} Suggested: clinician review within 48h; hold progression; confirm a pain-free arc before the next session.` });
  }
  if (a.flags?.highPain && status !== 'regression') {
    await call('create_alert', { ...base, severity: 'high', kind: 'pain',
      title: `Pain ${n0(m.pain)}/10 during ${payload.exercise_key}`,
      body: `Pain exceeded the comfortable range during the latest session (peak ${n0(payload.peak_rom)}°, ${payload.reps} reps). Suggested: reduce range to the pain-free arc and review.` });
  }
  if (a.flags?.highCompensation && status !== 'regression') {
    await call('create_alert', { ...base, severity: 'high', kind: 'compensation',
      title: `Compensation on ${n0(m.compensationPct)}% of reps`,
      body: 'The movement pattern is being substituted (trunk lean, shoulder hike, head tilt) on most reps. Suggested: re-cue the pattern and reduce range until compensation clears.' });
  }
  if (status === 'plateau') {
    await call('create_alert', { ...base, severity: 'medium', kind: 'plateau',
      title: `Plateau at ${n0(m.latestPeak)}° for 5 sessions`,
      body: `${list(a.reasons)} Plan progressed modestly (+5° target, +1 rep); confirm at next visit.` });
  }
  if ((status === 'plateau' || status === 'ready_to_progress') && history?.plan) {
    await call('adjust_plan', { patient_id: pid, target_rom: Number(history.plan.target_rom) + 5, reps: Number(history.plan.reps) + 1, rationale: `Automatic progression: ${list(a.reasons)}` });
  }
  if (status === 'non_adherent') {
    await call('create_alert', { patient_id: pid, severity: 'low', kind: 'adherence',
      title: `${n0(m.sessionsLast7)} of ${n0(m.prescribedPerWeek)} sessions this week`,
      body: 'Adherence is below 60% of the prescription. Suggested: a check-in message confirming access to the webcam program and a simpler schedule.' });
  }
  await call('write_progress_note', { ...base,
    note: `Objective: ${payload.exercise_key} (${payload.side}), peak ${n0(payload.peak_rom)}° vs target ${n0(m.target)}° (${n0(m.pctOfTarget)}%), ${payload.reps} reps, smoothness ${n0(payload.smoothness)}/100, compensation ${n0(payload.compensation_pct)}% of reps, pain ${n0(payload.pain_score)}/10. Assessment: ${a.statusLabel}. ${list(a.reasons)} Plan: ${list(a.recommendations)}`,
    metrics: { peak_rom: payload.peak_rom, target: m.target, reps: payload.reps, smoothness: payload.smoothness, compensation_pct: payload.compensation_pct, pain: payload.pain_score, status },
  });
  return finish(`${a.statusLabel}: ${list(a.reasons)}`, steps, id, started);
}

/** weekly_caseload_report protocol. */
export async function runWeeklyReport(bag, { runId } = {}) {
  const started = Date.now();
  const id = runId || (await newRunId(bag));
  const { call, steps } = makeCaller(bag, 'weekly_caseload_report', id, { event: '_cron', payload: {} });
  const caseload = await call('summarize_caseload', {});
  for (const p of caseload?.patients || []) {
    if (Number(p.adherence) < 60) {
      await call('create_alert', { patient_id: p.patient_id, severity: 'low', kind: 'adherence',
        title: `${p.sessions_7d} of ${p.prescribed_per_week} sessions this week`,
        body: `Weekly digest flagged adherence at ${n0(p.adherence)}%. Suggested: a short check-in message and confirm the home setup still works.` });
    }
  }
  const c = caseload?.counts || {};
  return finish(`Weekly digest — regression: ${c.regression ?? 0}, plateau: ${c.plateau ?? 0}, low adherence: ${c.non_adherent ?? 0}, ready to progress: ${c.ready_to_progress ?? 0}, on track: ${c.on_track ?? 0}`, steps, id, started);
}

/** Manual "Run now" for rehab_triage with no session: triage each patient's latest session. */
export async function runTriageForLatestSessions(bag) {
  const rows = await bag.query(
    `SELECT DISTINCT ON (patient_id) id, patient_id, exercise_key, side, reps, peak_rom, mean_rom, smoothness, compensation_pct, pain_score, source
       FROM sessions ORDER BY patient_id, started_at DESC`,
  );
  const id = await newRunId(bag);
  const started = Date.now();
  const steps = [];
  for (const s of rows) {
    const out = await runRehabTriage(bag, {
      patient_id: s.patient_id, session_id: s.id, exercise_key: s.exercise_key, side: s.side, reps: s.reps,
      peak_rom: Number(s.peak_rom), mean_rom: Number(s.mean_rom), smoothness: Number(s.smoothness), compensation_pct: Number(s.compensation_pct), pain_score: s.pain_score, source: s.source,
    }, { runId: id });
    steps.push(...out.steps);
  }
  return finish(`Triaged the latest session of ${rows.length} patients`, steps, id, started);
}

function finish(summary, steps, id, started) {
  steps.push({ type: 'text', text: summary });
  return { id, status: 'completed', mode: 'inline', durationMs: Date.now() - started, steps, summary };
}
