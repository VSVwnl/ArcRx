import { useEffect, useState } from 'react';
import { api, type Alert, type Caseload, type PatientSummary } from '../lib/api';
import { EXERCISE_SPECS, type ExerciseKey } from '../cv/types';
import { MiniBars, Section, SeverityDot, Sparkline, Spinner, Stat, StatusPill, timeAgo } from '../components/ui';
import PatientDetailView from './PatientDetail';

export default function ClinicianDashboard({ patients, refresh, version }: { patients: PatientSummary[]; refresh: () => void; version: number }) {
  const [caseload, setCaseload] = useState<Caseload | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    api.caseload().then(setCaseload).catch(() => {});
    api.alerts('open').then(setAlerts).catch(() => {});
  }, [version]);

  const act = async (a: Alert, status: Alert['status']) => {
    await api.setAlertStatus(a.id, status);
    setAlerts((xs) => xs.filter((x) => x.id !== a.id));
    refresh();
  };

  if (selected != null) {
    return <PatientDetailView patientId={selected} onBack={() => setSelected(null)} refresh={refresh} version={version} />;
  }

  const t = caseload?.totals;
  const weekly = (caseload?.weekly || []).map((w) => ({ label: new Date(w.week).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: w.sessions }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Patients" value={t?.patients ?? '—'} />
        <Stat label="Sessions · 7 days" value={t?.sessions_7d ?? '—'} tone="teal" />
        <Stat label="Open alerts" value={t?.open_alerts ?? '—'} tone={t?.high_alerts ? 'coral' : undefined} />
        <Stat label="Avg compensation · 7 d" value={t ? `${t.avg_comp_7d.toFixed(0)}%` : '—'} tone={t && t.avg_comp_7d >= 30 ? 'coral' : undefined} />
        <Stat label="Avg smoothness · 7 d" value={t ? t.avg_smooth_7d.toFixed(0) : '—'} unit="/100" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Section title="Caseload" aside={<span className="hidden text-xs text-mute sm:inline">Click a patient for the longitudinal record</span>} className="overflow-hidden">
          {/* Phone: one card per patient with the fields that matter. */}
          <ul className="space-y-2 sm:hidden">
            {patients.map((p) => {
              const m = p.assessment.metrics;
              const spec = p.plan ? EXERCISE_SPECS[p.plan.exercise_key as ExerciseKey] : null;
              return (
                <li key={p.id}>
                  <button className="w-full rounded-md border border-ink-700 bg-ink-800/40 p-3 text-left" onClick={() => setSelected(p.id)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{p.name}</div>
                        <div className="truncate text-xs text-mute">{spec?.label} · {p.plan?.side}</div>
                      </div>
                      <StatusPill status={p.assessment.status} label={p.assessment.statusLabel} />
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="numeral text-sm">
                        <span style={{ color: '#F5B942' }}>{m.latestPeak.toFixed(0)}°</span>
                        <span className="text-mute"> / {m.target}°</span>
                        <div className="mt-1 text-xs text-mute">{m.sessionsLast7}/{m.prescribedPerWeek} this week{p.openAlerts ? ` · ${p.openAlerts} alert${p.openAlerts > 1 ? 's' : ''}` : ''}</div>
                      </div>
                      <Sparkline values={p.sparkline} target={m.target} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <table className="data hidden sm:table">
            <thead>
              <tr><th>Patient</th><th>Exercise</th><th>Trajectory</th><th>Latest / target</th><th>Last 14 sessions</th><th>Adherence</th><th>Alerts</th></tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const m = p.assessment.metrics;
                const spec = p.plan ? EXERCISE_SPECS[p.plan.exercise_key as ExerciseKey] : null;
                return (
                  <tr key={p.id} className="cursor-pointer hover:bg-ink-800/60" onClick={() => setSelected(p.id)}>
                    <td>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-mute">{p.condition}</div>
                    </td>
                    <td className="text-sm text-mute">{spec?.label} · {p.plan?.side}</td>
                    <td><StatusPill status={p.assessment.status} label={p.assessment.statusLabel} /></td>
                    <td className="numeral">
                      <span style={{ color: '#F5B942' }}>{m.latestPeak.toFixed(0)}°</span>
                      <span className="text-mute"> / {m.target}°</span>
                      <div className="mt-1 h-1 w-24 rounded-full bg-ink-800"><div className="h-full rounded-full" style={{ width: `${Math.min(100, m.pctOfTarget)}%`, background: m.pctOfTarget >= 95 ? '#4FD1C5' : '#F5B942' }} /></div>
                    </td>
                    <td><Sparkline values={p.sparkline} target={m.target} /></td>
                    <td className="numeral">
                      <span style={{ color: m.adherence < 60 ? '#A78BFA' : '#EEF2FF' }}>{m.sessionsLast7}/{m.prescribedPerWeek}</span>
                      <div className="text-xs text-mute">{p.lastSession ? timeAgo(p.lastSession) : 'never'}</div>
                    </td>
                    <td className="numeral">{p.openAlerts || <span className="text-mute">0</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        <div className="space-y-4">
          <Section title={`Alert queue · ${alerts.length}`} aside={<span className="text-xs text-violet">raised by agents</span>}>
            {!alerts.length && <p className="text-sm text-mute">No open alerts. New sessions are triaged automatically.</p>}
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.id} className="rounded-md border border-ink-700 bg-ink-800/50 p-3">
                  <div className="flex items-start gap-2">
                    <SeverityDot severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.patient_name} — {a.title}</div>
                      <p className="mt-0.5 text-xs text-mute">{a.body}</p>
                      <div className="mt-1 text-[11px] text-mute">{a.kind} · {a.created_by} · {timeAgo(a.created_at)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button className="btn px-2 py-1 text-xs" onClick={() => setSelected(a.patient_id)}>Open chart</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act(a, 'acknowledged')}>Acknowledge</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act(a, 'resolved')}>Resolve</button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Sessions per week">
            {caseload ? <MiniBars data={weekly} color="#4FD1C5" height={150} /> : <Spinner />}
          </Section>
        </div>
      </div>
    </div>
  );
}
