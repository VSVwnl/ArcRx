// GET /api/_server/caseload — clinician-level aggregates for the dashboard header and charts.
export const config = { roles: ['clinician', 'admin'] };

export async function GET({ query }) {
  const [totals] = await query(
    `SELECT (SELECT COUNT(*)::int FROM patients) AS patients,
            (SELECT COUNT(*)::int FROM sessions WHERE started_at >= NOW() - INTERVAL '7 days') AS sessions_7d,
            (SELECT COUNT(*)::int FROM alerts WHERE status = 'open') AS open_alerts,
            (SELECT COUNT(*)::int FROM alerts WHERE status = 'open' AND severity = 'high') AS high_alerts,
            (SELECT ROUND(AVG(compensation_pct), 1) FROM sessions WHERE started_at >= NOW() - INTERVAL '7 days') AS avg_comp_7d,
            (SELECT ROUND(AVG(smoothness), 1) FROM sessions WHERE started_at >= NOW() - INTERVAL '7 days') AS avg_smooth_7d`,
  );
  const weekly = await query(
    `SELECT date_trunc('week', started_at)::date AS week, COUNT(*)::int AS sessions,
            ROUND(AVG(peak_rom), 1) AS avg_peak, ROUND(AVG(compensation_pct), 1) AS avg_comp
       FROM sessions WHERE started_at >= NOW() - INTERVAL '8 weeks'
      GROUP BY 1 ORDER BY 1`,
  );
  const perPatient = await query(
    `SELECT p.id, p.name, ep.exercise_key, ep.target_rom,
            MAX(s.peak_rom) FILTER (WHERE s.started_at >= NOW() - INTERVAL '7 days') AS best_7d,
            MAX(s.peak_rom) FILTER (WHERE s.started_at < NOW() - INTERVAL '7 days' AND s.started_at >= NOW() - INTERVAL '14 days') AS best_prev_7d,
            COUNT(s.id) FILTER (WHERE s.started_at >= NOW() - INTERVAL '7 days')::int AS sessions_7d,
            ep.frequency_per_week
       FROM patients p
       LEFT JOIN exercise_plans ep ON ep.patient_id = p.id AND ep.active = TRUE
       LEFT JOIN sessions s ON s.patient_id = p.id
      GROUP BY p.id, p.name, ep.exercise_key, ep.target_rom, ep.frequency_per_week
      ORDER BY p.name`,
  );
  return {
    totals: {
      ...totals,
      avg_comp_7d: Number(totals.avg_comp_7d ?? 0),
      avg_smooth_7d: Number(totals.avg_smooth_7d ?? 0),
    },
    weekly: weekly.map((w) => ({ ...w, avg_peak: Number(w.avg_peak), avg_comp: Number(w.avg_comp) })),
    perPatient: perPatient.map((r) => ({
      ...r,
      target_rom: Number(r.target_rom ?? 0),
      best_7d: r.best_7d == null ? null : Number(r.best_7d),
      best_prev_7d: r.best_prev_7d == null ? null : Number(r.best_prev_7d),
    })),
  };
}
