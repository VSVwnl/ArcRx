// Shared rehab domain logic, importable by server/ routes and tools/ (relative imports only).

/** Exercise catalogue. `model` is the MediaPipe task used client-side. */
export const EXERCISES = {
  shoulder_abduction: {
    key: 'shoulder_abduction',
    label: 'Shoulder abduction',
    joint: 'shoulder',
    model: 'pose',
    normalRom: 180,
    cue: 'Raise your arm out to the side, palm down, until it is level with your shoulder or higher.',
    compensations: ['trunk_lean', 'shoulder_hike'],
  },
  elbow_flexion: {
    key: 'elbow_flexion',
    label: 'Elbow flexion',
    joint: 'elbow',
    model: 'pose',
    normalRom: 145,
    cue: 'Keep your upper arm still at your side and bend your elbow, bringing your hand toward your shoulder.',
    compensations: ['shoulder_drift', 'trunk_lean'],
  },
  neck_rotation: {
    key: 'neck_rotation',
    label: 'Cervical rotation',
    joint: 'neck',
    model: 'face',
    normalRom: 80,
    cue: 'Keeping your shoulders square to the screen, turn your head to look over your shoulder.',
    compensations: ['shoulder_turn', 'head_tilt'],
  },
  neck_lateral_flexion: {
    key: 'neck_lateral_flexion',
    label: 'Cervical lateral flexion',
    joint: 'neck',
    model: 'face',
    normalRom: 45,
    cue: 'Drop your ear toward your shoulder without lifting the shoulder to meet it.',
    compensations: ['shoulder_hike', 'head_rotation'],
  },
};

export const COMPENSATION_LABELS = {
  trunk_lean: 'Trunk lean',
  shoulder_hike: 'Shoulder hike',
  shoulder_drift: 'Shoulder drift',
  shoulder_turn: 'Shoulder turn',
  head_tilt: 'Head tilt',
  head_rotation: 'Head rotation',
};

function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

export const STATUS_LABELS = {
  on_track: 'On track',
  ready_to_progress: 'Ready to progress',
  plateau: 'Plateau',
  regression: 'Regression',
  non_adherent: 'Low adherence',
  no_data: 'No sessions yet',
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Deterministic trajectory assessment used by the assess_progress tool, the
 * triage agent's offline fallback, and the clinician dashboard.
 *
 * @param {Array<{started_at:string, peak_rom:number, compensation_pct:number, pain_score:number, smoothness:number}>} sessions any order
 * @param {{target_rom:number, frequency_per_week:number, pain_threshold:number}} plan
 * @param {Date} [now]
 */
export function assessProgress(sessions, plan, now = new Date()) {
  const ordered = [...sessions].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  const peaks = ordered.map((s) => Number(s.peak_rom));
  const latest = ordered[ordered.length - 1] || null;
  const target = Number(plan?.target_rom ?? 0);
  const last5 = peaks.slice(-5);
  const prev3 = peaks.slice(-4, -1);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const sessionsLast7 = ordered.filter((s) => new Date(s.started_at) >= weekAgo).length;
  const prescribed = Number(plan?.frequency_per_week ?? 5);
  const adherence = prescribed ? Math.min(1, sessionsLast7 / prescribed) : 1;
  const slope5 = linearSlope(last5); // degrees per session
  const latestPeak = latest ? Number(latest.peak_rom) : 0;
  const prevMean = prev3.length ? mean(prev3) : latestPeak;
  const dropPct = prevMean ? ((prevMean - latestPeak) / prevMean) * 100 : 0;
  const pain = latest ? Number(latest.pain_score) : 0;
  const comp = latest ? Number(latest.compensation_pct) : 0;
  const compTrend = linearSlope(ordered.slice(-5).map((s) => Number(s.compensation_pct)));
  const pctOfTarget = target ? (latestPeak / target) * 100 : 0;

  let status = 'on_track';
  const reasons = [];
  if (!latest) {
    status = 'no_data';
  } else if (dropPct >= 10 && prev3.length >= 2) {
    status = 'regression';
    reasons.push(`Peak ROM fell ${dropPct.toFixed(0)}% vs the previous 3 sessions (${prevMean.toFixed(0)}° → ${latestPeak.toFixed(0)}°).`);
  } else if (pain >= Number(plan?.pain_threshold ?? 5) + 1) {
    status = 'regression';
    reasons.push(`Pain ${pain}/10 exceeds the plan threshold.`);
  } else if (adherence < 0.6 && ordered.length >= 3) {
    status = 'non_adherent';
    reasons.push(`${sessionsLast7} of ${prescribed} prescribed sessions completed in the last 7 days.`);
  } else if (last5.length >= 5 && Math.abs(slope5) < 1.0 && pctOfTarget < 95) {
    status = 'plateau';
    reasons.push(`No meaningful gain across the last 5 sessions (slope ${slope5.toFixed(1)}°/session) at ${pctOfTarget.toFixed(0)}% of target.`);
  } else if (pctOfTarget >= 95 && last5.length >= 3) {
    status = 'ready_to_progress';
    reasons.push(`Reaching ${pctOfTarget.toFixed(0)}% of the ${target}° target consistently.`);
  } else {
    reasons.push(`Gaining ${slope5.toFixed(1)}°/session; ${pctOfTarget.toFixed(0)}% of target.`);
  }
  if (comp >= 40) reasons.push(`Compensation on ${comp.toFixed(0)}% of reps in the latest session.`);
  if (compTrend > 3) reasons.push('Compensation rising over the last 5 sessions.');
  if (pain >= 6 && status !== 'regression') reasons.push(`Pain ${pain}/10 reported.`);

  const flags = {
    highPain: pain >= 6,
    highCompensation: comp >= 40,
    risingCompensation: compTrend > 3,
  };

  const recommendations = [];
  if (status === 'regression') recommendations.push('Clinician review within 48h; hold progression; confirm pain-free arc before next session.');
  if (status === 'plateau') recommendations.push('Progress the prescription modestly (+5–10° target or +2 reps) and add an end-range hold.');
  if (status === 'non_adherent') recommendations.push('Outreach: confirm access to the webcam program and simplify the schedule.');
  if (status === 'ready_to_progress') recommendations.push('Advance to the next stage of the protocol.');
  if (flags.highCompensation || flags.risingCompensation) recommendations.push('Re-cue the movement pattern; reduce range until compensation clears.');

  return {
    status,
    statusLabel: STATUS_LABELS[status],
    reasons,
    recommendations,
    flags,
    metrics: {
      sessions: ordered.length,
      latestPeak: Number(latestPeak.toFixed(1)),
      target,
      pctOfTarget: Number(pctOfTarget.toFixed(0)),
      slopePerSession: Number(slope5.toFixed(2)),
      dropPct: Number(dropPct.toFixed(1)),
      adherence: Number((adherence * 100).toFixed(0)),
      sessionsLast7,
      prescribedPerWeek: prescribed,
      pain,
      compensationPct: Number(comp.toFixed(0)),
      compensationTrend: Number(compTrend.toFixed(1)),
      smoothness: latest ? Number(latest.smoothness) : null,
    },
  };
}

/** Who may see which patient rows. Clinicians/admins see all; patients see their own. */
export async function resolvePatientScope({ query, request, platform }) {
  const roles = request.roles || [];
  if (roles.includes('clinician') || roles.includes('admin')) return { all: true, patientId: null };
  const username = request.user?.username;
  const rows = await query('SELECT id FROM patients WHERE username = $1', [username]);
  if (rows.length) return { all: false, patientId: rows[0].id };
  // Dev mirror convenience: the mock user has no patient row; allow full read so the demo works.
  if (platform?.version === 'dev') return { all: true, patientId: null, devFallback: true };
  return { all: false, patientId: -1 };
}

/** Appends a scope predicate for queries that have a `patient_id` column aliased as `alias`. */
export function scopeClause(scope, alias, params) {
  if (scope.all) return '';
  params.push(scope.patientId);
  return ` AND ${alias}.patient_id = $${params.length}`;
}
