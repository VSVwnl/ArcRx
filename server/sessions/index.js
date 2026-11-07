// POST /api/_server/sessions — persist a scored webcam session and emit session.completed.
// GET  /api/_server/sessions?patient_id=…&limit=… — recent sessions.
import { assessProgress, resolvePatientScope, scopeClause } from '../../lib/rehab.js';

export async function GET({ query, request, platform }) {
  const scope = await resolvePatientScope({ query, request, platform });
  const params = [];
  let where = '1 = 1';
  if (request.query.patient_id) {
    params.push(Number(request.query.patient_id));
    where += ` AND s.patient_id = $${params.length}`;
  }
  where += scopeClause(scope, 's', params);
  params.push(Math.min(Number(request.query.limit || 50), 500));
  return query(`SELECT s.* FROM sessions s WHERE ${where} ORDER BY s.started_at DESC LIMIT $${params.length}`, params);
}

export async function POST({ query, request, platform, emit, transaction, log }) {
  const b = request.body || {};
  const scope = await resolvePatientScope({ query, request, platform });
  const patientId = Number(b.patient_id);
  if (!scope.all && scope.patientId !== patientId) return { status: 403, body: { message: 'Not your record' } };
  if (!Array.isArray(b.reps) || b.reps.length === 0) return { status: 400, body: { message: 'A session needs at least one rep' } };

  const [plan] = await query('SELECT * FROM exercise_plans WHERE patient_id = $1 AND active = TRUE ORDER BY id DESC LIMIT 1', [patientId]);
  const peaks = b.reps.map((r) => Number(r.peak_angle));
  const peak = Math.max(...peaks);
  const meanRom = peaks.reduce((a, c) => a + c, 0) / peaks.length;
  const smooth = b.reps.reduce((a, r) => a + Number(r.smoothness), 0) / b.reps.length;
  const flagged = b.reps.filter((r) => (r.compensation_flags || []).length > 0).length;
  const compPct = (flagged / b.reps.length) * 100;

  const run = async (q) => {
    const [session] = await q(
      `INSERT INTO sessions (patient_id, plan_id, exercise_key, side, started_at, ended_at, reps, peak_rom, mean_rom, smoothness, compensation_pct, pain_score, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [patientId, plan?.id ?? null, b.exercise_key, b.side || plan?.side || 'right', b.started_at, b.ended_at || new Date().toISOString(),
        b.reps.length, peak.toFixed(1), meanRom.toFixed(1), smooth.toFixed(1), compPct.toFixed(1), Number(b.pain_score || 0), b.source || 'webcam'],
    );
    for (const [i, r] of b.reps.entries()) {
      await q(
        `INSERT INTO reps (session_id, rep_index, peak_angle, duration_ms, hold_ms, smoothness, compensation_flags) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [session.id, i + 1, Number(r.peak_angle).toFixed(1), Math.round(r.duration_ms || 0), Math.round(r.hold_ms || 0), Number(r.smoothness).toFixed(1), JSON.stringify(r.compensation_flags || [])],
      );
    }
    return session;
  };
  const session = transaction ? await transaction(({ query: q }) => run(q)) : await run(query);

  const history = await query('SELECT * FROM sessions WHERE patient_id = $1 ORDER BY started_at DESC LIMIT 60', [patientId]);
  const assessment = assessProgress(history, plan);

  const payload = {
    patient_id: patientId,
    session_id: session.id,
    exercise_key: session.exercise_key,
    side: session.side,
    reps: session.reps,
    peak_rom: Number(session.peak_rom),
    mean_rom: Number(session.mean_rom),
    smoothness: Number(session.smoothness),
    compensation_pct: Number(session.compensation_pct),
    pain_score: session.pain_score,
    source: session.source,
    assessment_status: assessment.status,
  };
  // In production Informer dispatches agents subscribed with `on: session.completed`.
  await emit('session.completed', payload);
  log('session.completed', payload);
  return { session: payload, assessment };
}
