// GET  /api/patients — caseload with each patient's active plan and trajectory assessment.
// POST /api/patients — clinicians add a patient with their first prescription (optionally
//                      linked to the caller's own account, so they can exercise as that patient).
import { EXERCISES, assessProgress, resolvePatientScope } from '../../lib/rehab.js';

const PLAN_BOUNDS = { target_rom: [1, 180], sets: [1, 10], reps: [1, 50], frequency_per_week: [1, 14], pain_threshold: [0, 10] };
const PLAN_DEFAULTS = { sets: 3, reps: 10, frequency_per_week: 5, pain_threshold: 5 };

export async function POST({ query, transaction, request }) {
  const roles = request.roles || [];
  if (!roles.includes('clinician') && !roles.includes('admin')) return { status: 403, body: { message: 'Only clinicians can add patients' } };
  const b = request.body || {};
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  const condition = String(b.condition || '').trim();
  if (name.length < 2 || name.length > 80) return { status: 400, body: { message: 'Name must be 2-80 characters' } };
  if (condition.length < 2 || condition.length > 160) return { status: 400, body: { message: 'Condition must be 2-160 characters' } };
  const exercise = EXERCISES[b.exercise_key];
  if (!exercise) return { status: 400, body: { message: 'Unknown exercise_key' } };
  const side = b.side || 'right';
  if (!['left', 'right'].includes(side)) return { status: 400, body: { message: 'side must be left or right' } };
  const plan = {};
  for (const k of Object.keys(PLAN_BOUNDS)) {
    const v = b[k] === undefined || b[k] === null || b[k] === '' ? PLAN_DEFAULTS[k] : Number(b[k]);
    const [lo, hi] = PLAN_BOUNDS[k];
    if (v === undefined || !Number.isFinite(v) || v < lo || v > hi || (k !== 'target_rom' && !Number.isInteger(v))) {
      return { status: 400, body: { message: `${k} must be ${k === 'target_rom' ? 'a number' : 'a whole number'} between ${lo} and ${hi}` } };
    }
    plan[k] = v;
  }
  if (plan.target_rom === undefined) return { status: 400, body: { message: 'target_rom is required' } };
  let surgeryDate = null;
  if (b.surgery_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.surgery_date)) || Number.isNaN(Date.parse(b.surgery_date))) return { status: 400, body: { message: 'surgery_date must be YYYY-MM-DD' } };
    surgeryDate = String(b.surgery_date);
  }
  const me = request.user || {};
  const myKey = me.username || me.id || me.email || null;
  const linkToMe = b.link_to_me === true;
  if (linkToMe && !myKey) return { status: 400, body: { message: 'Your account has no identity to link' } };
  if (linkToMe) {
    const [existing] = await query('SELECT id, name FROM patients WHERE username = $1', [String(myKey)]);
    if (existing) return { status: 409, body: { message: `Your account is already linked to ${existing.name}`, patient_id: existing.id } };
  }
  const mrn = `ARX-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;

  const run = async (q) => {
    const [patient] = await q(
      'INSERT INTO patients (username, mrn, name, condition, surgery_date, clinician) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [linkToMe ? String(myKey) : null, mrn, name, condition, surgeryDate, String(myKey || 'clinician')],
    );
    const [row] = await q(
      'INSERT INTO exercise_plans (patient_id, exercise_key, side, target_rom, sets, reps, frequency_per_week, pain_threshold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [patient.id, exercise.key, side, plan.target_rom, plan.sets, plan.reps, plan.frequency_per_week, plan.pain_threshold],
    );
    return { patient, plan: { ...row, target_rom: Number(row.target_rom) } };
  };
  const created = transaction ? await transaction(({ query: q }) => run(q)) : await run(query);
  return { status: 201, body: { id: created.patient.id, patient: created.patient, plan: created.plan } };
}

export async function GET({ query, request, platform }) {
  const scope = await resolvePatientScope({ query, request, platform });
  const params = [];
  // patients is keyed by id; scopeClause targets tables that carry a patient_id column.
  let where = '';
  if (!scope.all) { params.push(scope.patientId); where = ` AND p.id = $${params.length}`; }
  const patients = await query(
    `SELECT p.*, ep.id AS plan_id, ep.exercise_key, ep.side, ep.target_rom, ep.sets, ep.reps AS plan_reps,
            ep.frequency_per_week, ep.pain_threshold
       FROM patients p
       LEFT JOIN exercise_plans ep ON ep.patient_id = p.id AND ep.active = TRUE
      WHERE 1 = 1${where}
      ORDER BY p.name`,
    params,
  );
  const sessions = await query(
    `SELECT s.patient_id, s.started_at, s.peak_rom, s.compensation_pct, s.pain_score, s.smoothness
       FROM sessions s
      WHERE s.started_at >= NOW() - INTERVAL '60 days'
      ORDER BY s.started_at`,
  );
  const openAlerts = await query(
    `SELECT patient_id, COUNT(*)::int AS n, MAX(severity) AS top FROM alerts WHERE status = 'open' GROUP BY patient_id`,
  );
  const alertMap = Object.fromEntries(openAlerts.map((a) => [a.patient_id, a]));
  return patients.map((p) => {
    const hist = sessions.filter((s) => s.patient_id === p.id);
    const assessment = assessProgress(hist, p);
    return {
      id: p.id,
      name: p.name,
      mrn: p.mrn,
      username: p.username,
      condition: p.condition,
      surgery_date: p.surgery_date,
      clinician: p.clinician,
      plan: p.plan_id
        ? {
            id: p.plan_id,
            exercise_key: p.exercise_key,
            side: p.side,
            target_rom: Number(p.target_rom),
            sets: p.sets,
            reps: p.plan_reps,
            frequency_per_week: p.frequency_per_week,
            pain_threshold: p.pain_threshold,
          }
        : null,
      assessment,
      openAlerts: alertMap[p.id]?.n ?? 0,
      lastSession: hist.length ? hist[hist.length - 1].started_at : null,
      sparkline: hist.slice(-14).map((s) => Number(s.peak_rom)),
    };
  });
}
