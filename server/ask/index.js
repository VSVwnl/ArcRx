// POST /api/_server/ask — "Ask your rehab data" in natural language.
//
// Two governed paths:
//   1. AI (when Informer AI / the dev mirror's LLM is available): the model
//      drafts a read-only SQL query over the documented workspace schema, the
//      route validates it (SELECT-only, single statement, LIMIT), runs it in
//      the app's private workspace and asks the model to narrate the rows.
//   2. Rules: a deterministic intent router answers the common clinical
//      questions from the same tables, so the feature works fully offline.
// Patients always take path 2 scoped to their own record.
import { askObject, guardReadOnlySql } from '../../lib/ai.js';
import { assessProgress, EXERCISES, STATUS_LABELS, resolvePatientScope } from '../../lib/rehab.js';

const SCHEMA_DOC = `
Tables (Postgres):
patients(id, username, mrn, name, condition, surgery_date, clinician)
exercise_plans(id, patient_id, exercise_key, side, target_rom, sets, reps, frequency_per_week, pain_threshold, active)
sessions(id, patient_id, plan_id, exercise_key, side, started_at timestamptz, ended_at, reps, peak_rom, mean_rom, smoothness 0-100, compensation_pct 0-100, pain_score 0-10, source)
reps(id, session_id, rep_index, peak_angle, duration_ms, hold_ms, smoothness, compensation_flags jsonb array of text)
alerts(id, patient_id, session_id, severity low|medium|high, kind, title, body, status open|acknowledged|resolved, created_by, created_at)
progress_notes(id, patient_id, session_id, author, note, metrics jsonb, created_at)
plan_changes(id, patient_id, plan_id, change jsonb, rationale, created_by, created_at)
exercise_key values: ${Object.keys(EXERCISES).join(', ')}. ROM values are degrees. "Now" is NOW().`;

export async function POST({ query, request, platform, fetch, log }) {
  const question = String(request.body?.question || '').trim();
  if (!question) return { status: 400, body: { message: 'question is required' } };
  const scope = await resolvePatientScope({ query, request, platform });
  const isClinician = scope.all && !scope.devFallback ? true : (request.roles || []).includes('clinician');

  if (isClinician) {
    const ai = await answerWithAi({ query, fetch, question, log });
    if (ai) return ai;
  }
  return answerWithRules({ query, question, scope });
}

async function answerWithAi({ query, fetch, question, log }) {
  const plan = await askObject(fetch, {
    model: 'go_everyday',
    system: `You translate a physical therapist's question into ONE read-only Postgres SELECT over this schema.${SCHEMA_DOC}
Return JSON only. Prefer joining patients for names. Use ROUND for numerics. Never modify data.`,
    prompt: `Question: ${question}`,
    schema: {
      type: 'object',
      properties: {
        sql: { type: 'string' },
        explanation: { type: 'string' },
        chart: {
          type: ['object', 'null'],
          properties: { type: { type: 'string', enum: ['bar', 'line'] }, labelColumn: { type: 'string' }, valueColumn: { type: 'string' } },
        },
      },
      required: ['sql', 'explanation'],
    },
  });
  if (!plan || !plan.sql) return null;
  const guard = guardReadOnlySql(plan.sql);
  if (!guard.ok) {
    log.warn('ask: rejected AI SQL', { reason: guard.reason, sql: plan.sql });
    return null;
  }
  let rows;
  try {
    rows = await query(guard.sql);
  } catch (err) {
    log.warn('ask: AI SQL failed', { message: err.message });
    return null;
  }
  const narrated = await askObject(fetch, {
    model: 'go_everyday',
    system: 'You are a concise clinical analytics assistant for physical therapists. Answer in at most 4 sentences using only the rows provided. Quote numbers with units (degrees, %, /10). Do not diagnose.',
    prompt: `Question: ${question}\nQuery explanation: ${plan.explanation}\nRows (JSON): ${JSON.stringify(rows.slice(0, 60))}`,
    schema: { type: 'object', properties: { answer: { type: 'string' }, highlights: { type: 'array', items: { type: 'string' } } }, required: ['answer'] },
  });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const chart = plan.chart && columns.includes(plan.chart.labelColumn) && columns.includes(plan.chart.valueColumn)
    ? { type: plan.chart.type || 'bar', data: rows.slice(0, 20).map((r) => ({ label: String(r[plan.chart.labelColumn]), value: Number(r[plan.chart.valueColumn]) })) }
    : null;
  return {
    mode: 'ai',
    answer: narrated?.answer || plan.explanation,
    highlights: narrated?.highlights || [],
    sql: guard.sql,
    table: { columns, rows: rows.slice(0, 50) },
    chart,
  };
}

async function loadCaseload(query, scope) {
  const params = [];
  const where = scope.all ? '' : (params.push(scope.patientId), ' WHERE p.id = $1');
  const patients = await query(
    `SELECT p.*, ep.exercise_key, ep.side, ep.target_rom, ep.frequency_per_week, ep.pain_threshold, ep.reps AS plan_reps
       FROM patients p LEFT JOIN exercise_plans ep ON ep.patient_id = p.id AND ep.active = TRUE${where} ORDER BY p.name`,
    params,
  );
  const sessions = await query(`SELECT * FROM sessions WHERE started_at >= NOW() - INTERVAL '60 days' ORDER BY started_at`);
  return patients.map((p) => {
    const hist = sessions.filter((s) => s.patient_id === p.id);
    return { ...p, target_rom: Number(p.target_rom), hist, assessment: assessProgress(hist, p) };
  });
}

const fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(d));

async function answerWithRules({ query, question, scope }) {
  const q = question.toLowerCase();
  const caseload = await loadCaseload(query, scope);
  const named = caseload.find((p) => q.includes(p.name.split(' ')[0].toLowerCase()) || q.includes(p.name.toLowerCase()));
  const base = { mode: 'rules', highlights: [], sql: null };
  const table = (columns, rows) => ({ columns, rows });
  const chart = (data, type = 'bar') => ({ type, data });

  if (named) {
    const a = named.assessment;
    const m = a.metrics;
    const ex = EXERCISES[named.exercise_key]?.label || named.exercise_key;
    return {
      ...base,
      answer: `${named.name} (${named.condition}) is ${STATUS_LABELS[a.status].toLowerCase()} on ${ex.toLowerCase()} (${named.side}). Latest peak ${fmt(m.latestPeak)}° of a ${m.target}° target (${m.pctOfTarget}%), trend ${fmt(m.slopePerSession, 1)}°/session, ${m.sessionsLast7}/${m.prescribedPerWeek} sessions this week, pain ${m.pain}/10, compensation on ${m.compensationPct}% of reps.`,
      highlights: [...a.reasons, ...a.recommendations],
      table: table(['date', 'peak_rom', 'reps', 'compensation_pct', 'pain'], named.hist.slice(-10).reverse().map((s) => ({ date: String(s.started_at).slice(0, 10), peak_rom: Number(s.peak_rom), reps: s.reps, compensation_pct: Number(s.compensation_pct), pain: s.pain_score }))),
      chart: chart(named.hist.slice(-14).map((s) => ({ label: String(s.started_at).slice(5, 10), value: Number(s.peak_rom) })), 'line'),
    };
  }
  if (/regress|worse|declin|lost|drop/.test(q)) {
    const rows = caseload.filter((p) => p.assessment.status === 'regression');
    return {
      ...base,
      answer: rows.length ? `${rows.length} patient${rows.length > 1 ? 's' : ''} regressed: ${rows.map((p) => `${p.name} (${fmt(p.assessment.metrics.dropPct)}% drop, pain ${p.assessment.metrics.pain}/10)`).join('; ')}.` : 'No patient shows a regression in the last three sessions.',
      highlights: rows.flatMap((p) => p.assessment.reasons.map((r) => `${p.name}: ${r}`)),
      table: table(['patient', 'latest_peak', 'drop_pct', 'pain'], rows.map((p) => ({ patient: p.name, latest_peak: p.assessment.metrics.latestPeak, drop_pct: p.assessment.metrics.dropPct, pain: p.assessment.metrics.pain }))),
      chart: chart(caseload.map((p) => ({ label: p.name.split(' ')[0], value: p.assessment.metrics.dropPct }))),
    };
  }
  if (/adheren|missed|skipp|practi|compliance|haven'?t/.test(q)) {
    const rows = [...caseload].sort((a, b) => a.assessment.metrics.adherence - b.assessment.metrics.adherence);
    const low = rows.filter((p) => p.assessment.metrics.adherence < 60);
    return {
      ...base,
      answer: low.length ? `${low.map((p) => `${p.name} completed ${p.assessment.metrics.sessionsLast7} of ${p.assessment.metrics.prescribedPerWeek} prescribed sessions this week`).join('; ')}. Everyone else is at or above 60% adherence.` : 'All patients are at or above 60% of their prescribed weekly sessions.',
      table: table(['patient', 'sessions_7d', 'prescribed', 'adherence_pct'], rows.map((p) => ({ patient: p.name, sessions_7d: p.assessment.metrics.sessionsLast7, prescribed: p.assessment.metrics.prescribedPerWeek, adherence_pct: p.assessment.metrics.adherence }))),
      chart: chart(rows.map((p) => ({ label: p.name.split(' ')[0], value: p.assessment.metrics.adherence }))),
    };
  }
  if (/plateau|stall|stuck|flat/.test(q)) {
    const rows = caseload.filter((p) => p.assessment.status === 'plateau');
    return {
      ...base,
      answer: rows.length ? `${rows.map((p) => `${p.name} has plateaued at ${fmt(p.assessment.metrics.latestPeak)}° (${p.assessment.metrics.pctOfTarget}% of target) across the last five sessions`).join('; ')}.` : 'No patient is plateaued right now.',
      highlights: rows.flatMap((p) => p.assessment.recommendations.map((r) => `${p.name}: ${r}`)),
      table: table(['patient', 'latest_peak', 'target', 'slope_per_session'], rows.map((p) => ({ patient: p.name, latest_peak: p.assessment.metrics.latestPeak, target: p.assessment.metrics.target, slope_per_session: p.assessment.metrics.slopePerSession }))),
      chart: null,
    };
  }
  if (/compensat|hike|lean|form|quality/.test(q)) {
    const rows = [...caseload].sort((a, b) => b.assessment.metrics.compensationPct - a.assessment.metrics.compensationPct);
    return {
      ...base,
      answer: `Highest compensation this week: ${rows.slice(0, 2).map((p) => `${p.name} at ${p.assessment.metrics.compensationPct}% of reps`).join(' and ')}. Rising trends are flagged below.`,
      highlights: rows.filter((p) => p.assessment.flags.risingCompensation).map((p) => `${p.name}: compensation rising over the last five sessions.`),
      table: table(['patient', 'compensation_pct', 'trend', 'smoothness'], rows.map((p) => ({ patient: p.name, compensation_pct: p.assessment.metrics.compensationPct, trend: p.assessment.metrics.compensationTrend, smoothness: p.assessment.metrics.smoothness }))),
      chart: chart(rows.map((p) => ({ label: p.name.split(' ')[0], value: p.assessment.metrics.compensationPct }))),
    };
  }
  if (/pain/.test(q)) {
    const rows = [...caseload].sort((a, b) => b.assessment.metrics.pain - a.assessment.metrics.pain);
    return {
      ...base,
      answer: `Latest pain scores: ${rows.map((p) => `${p.name} ${p.assessment.metrics.pain}/10`).join(', ')}.`,
      table: table(['patient', 'pain', 'threshold'], rows.map((p) => ({ patient: p.name, pain: p.assessment.metrics.pain, threshold: p.pain_threshold }))),
      chart: chart(rows.map((p) => ({ label: p.name.split(' ')[0], value: p.assessment.metrics.pain }))),
    };
  }
  if (/alert/.test(q)) {
    const alerts = await query(`SELECT a.severity, a.kind, a.title, p.name FROM alerts a JOIN patients p ON p.id = a.patient_id WHERE a.status = 'open' ORDER BY a.created_at DESC LIMIT 20`);
    return {
      ...base,
      answer: alerts.length ? `${alerts.length} open alert${alerts.length > 1 ? 's' : ''}: ${alerts.slice(0, 4).map((a) => `${a.name} — ${a.title} (${a.severity})`).join('; ')}.` : 'No open alerts.',
      table: table(['patient', 'severity', 'kind', 'title'], alerts.map((a) => ({ patient: a.name, severity: a.severity, kind: a.kind, title: a.title }))),
      chart: null,
    };
  }
  if (/best|most improv|progress|gain|fastest|ready/.test(q)) {
    const rows = [...caseload].sort((a, b) => b.assessment.metrics.slopePerSession - a.assessment.metrics.slopePerSession);
    return {
      ...base,
      answer: `${rows[0].name} is improving fastest at ${fmt(rows[0].assessment.metrics.slopePerSession, 1)}°/session (${rows[0].assessment.metrics.pctOfTarget}% of target). ${rows.filter((p) => p.assessment.status === 'ready_to_progress').map((p) => p.name).join(', ') || 'Nobody'} is ready to progress.`,
      table: table(['patient', 'slope_per_session', 'pct_of_target', 'status'], rows.map((p) => ({ patient: p.name, slope_per_session: p.assessment.metrics.slopePerSession, pct_of_target: p.assessment.metrics.pctOfTarget, status: STATUS_LABELS[p.assessment.status] }))),
      chart: chart(rows.map((p) => ({ label: p.name.split(' ')[0], value: p.assessment.metrics.pctOfTarget }))),
    };
  }
  // Default: caseload overview
  const byStatus = {};
  for (const p of caseload) (byStatus[p.assessment.status] ||= []).push(p.name);
  return {
    ...base,
    answer: `${caseload.length} patients on the caseload. ${Object.entries(byStatus).map(([s, names]) => `${STATUS_LABELS[s]}: ${names.join(', ')}`).join('. ')}. Try: "who regressed this week", "who is missing sessions", "who is plateaued", "show compensation", or a patient's name.`,
    table: table(['patient', 'exercise', 'latest_peak', 'target', 'status'], caseload.map((p) => ({ patient: p.name, exercise: EXERCISES[p.exercise_key]?.label || p.exercise_key, latest_peak: p.assessment.metrics.latestPeak, target: p.assessment.metrics.target, status: STATUS_LABELS[p.assessment.status] }))),
    chart: chart(caseload.map((p) => ({ label: p.name.split(' ')[0], value: p.assessment.metrics.pctOfTarget }))),
  };
}
