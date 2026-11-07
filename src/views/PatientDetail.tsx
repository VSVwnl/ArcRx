import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type PatientDetail } from '../lib/api';
import { COMPENSATION_LABELS, EXERCISE_SPECS, type ExerciseKey } from '../cv/types';
import { fmtDate, Section, SeverityDot, Spinner, Stat, StatusPill, timeAgo } from '../components/ui';

const tooltipStyle = { background: '#18233B', border: '1px solid #334467', borderRadius: 8, fontSize: 12, color: '#EEF2FF' };
const FLAG_COLORS: Record<string, string> = { trunk_lean: '#F0636B', shoulder_hike: '#F5B942', shoulder_drift: '#A78BFA', head_tilt: '#F0636B', head_rotation: '#A78BFA', chin_drop: '#F5B942' };

export default function PatientDetailView({ patientId, onBack, refresh, version }: { patientId: number; onBack: () => void; refresh: () => void; version: number }) {
  const [d, setD] = useState<PatientDetail | null>(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.patient(patientId).then((x) => { setD(x); setTarget(x.plan?.target_rom ?? null); }).catch(() => {});
  }, [patientId, version]);

  if (!d) return <Spinner label="Loading chart" />;
  const a = d.assessment;
  const m = a.metrics;
  const spec = d.plan ? EXERCISE_SPECS[d.plan.exercise_key as ExerciseKey] : null;
  const series = d.sessions.slice().reverse().map((s) => ({ label: fmtDate(s.started_at), peak: s.peak_rom, mean: s.mean_rom, comp: s.compensation_pct, pain: s.pain_score }));
  const reps = d.lastReps.map((r) => ({ label: `#${r.rep_index}`, value: Number(r.peak_angle), flagged: r.compensation_flags.length > 0, smooth: Number(r.smoothness) }));
  const compByDay = Object.values(d.compensation.reduce<Record<string, Record<string, number | string>>>((acc, row) => {
    const day = fmtDate(String(row.day));
    acc[day] ||= { label: day };
    acc[day][row.flag] = Number(acc[day][row.flag] || 0) + row.n;
    return acc;
  }, {}));
  const flagKeys = Array.from(new Set(d.compensation.map((c) => c.flag)));

  const savePlan = async () => {
    if (!d.plan || target == null) return;
    setBusy(true);
    try {
      await api.updatePlan(d.plan.id, { target_rom: target, rationale: 'Clinician adjustment from the chart' });
      refresh();
    } finally { setBusy(false); }
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.addNote(d.patient.id, note.trim());
      setNote('');
      refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button className="btn btn-ghost -ml-2 px-2 py-1 text-xs" onClick={onBack}>← Caseload</button>
          <h2 className="mt-1 text-xl font-semibold">{d.patient.name} <span className="text-sm font-normal text-mute">{d.patient.mrn}</span></h2>
          <p className="text-sm text-mute">{d.patient.condition}{d.patient.surgery_date ? ` · surgery ${fmtDate(d.patient.surgery_date)}` : ''}{spec ? ` · ${spec.label}, ${d.plan?.side}` : ''}</p>
        </div>
        <StatusPill status={a.status} label={a.statusLabel} />
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Stat label="Latest peak" value={m.latestPeak.toFixed(0)} unit={`° / ${m.target}°`} tone="amber" />
        <Stat label="Trend" value={`${m.slopePerSession >= 0 ? '+' : ''}${m.slopePerSession.toFixed(1)}`} unit="° / session" tone={m.slopePerSession < 0 ? 'coral' : 'teal'} />
        <Stat label="Adherence · 7 d" value={`${m.adherence}%`} tone={m.adherence < 60 ? 'violet' : undefined} />
        <Stat label="Compensation" value={`${m.compensationPct}%`} unit="of reps" tone={m.compensationPct >= 40 ? 'coral' : undefined} />
        <Stat label="Pain" value={`${m.pain}`} unit="/ 10" tone={m.pain >= 6 ? 'coral' : undefined} />
      </div>

      <div className="panel p-4">
        <div className="text-sm">{a.reasons.join(' ')}</div>
        {a.recommendations.length > 0 && <div className="mt-1 text-sm text-teal">{a.recommendations.join(' ')}</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="space-y-4">
          <Section title="Range of motion trajectory" aside={<span className="text-xs text-mute">best rep per session · dashed = target</span>}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={series} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="rgba(238,242,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} unit="°" />
                <Tooltip contentStyle={tooltipStyle} />
                {d.plan && <ReferenceLine y={d.plan.target_rom} stroke="#4FD1C5" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="peak" name="Peak" stroke="#F5B942" strokeWidth={2.2} dot={{ r: 2.5, fill: '#F5B942' }} />
                <Line type="monotone" dataKey="mean" name="Mean" stroke="rgba(238,242,255,0.35)" strokeWidth={1.2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Rep-by-rep, last session" aside={<span className="text-xs text-mute">coral = compensation</span>}>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={reps} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} unit="°" />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(238,242,255,0.05)' }} />
                  {d.plan && <ReferenceLine y={d.plan.target_rom} stroke="#4FD1C5" strokeDasharray="4 4" />}
                  <Bar dataKey="value" name="Peak" radius={[4, 4, 0, 0]}>
                    {reps.map((r, i) => <Cell key={i} fill={r.flagged ? '#F0636B' : '#F5B942'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Section>
            <Section title="Compensation, last 45 days" aside={<span className="text-xs text-mute">flagged reps per day</span>}>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={compByDay} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis tick={{ fill: '#8A96B3', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(238,242,255,0.05)' }} />
                  {flagKeys.map((k) => <Bar key={k} dataKey={k} name={COMPENSATION_LABELS[k] || k} stackId="c" fill={FLAG_COLORS[k] || '#8A96B3'} />)}
                </BarChart>
              </ResponsiveContainer>
            </Section>
          </div>
        </div>

        <div className="space-y-4">
          <Section title="Prescription" aside={<span className="text-xs text-mute">{d.planChanges.length} change{d.planChanges.length === 1 ? '' : 's'}</span>}>
            {d.plan ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-mute">Exercise</span><span>{spec?.label} · {d.plan.side}</span></div>
                <div className="flex justify-between"><span className="text-mute">Dose</span><span>{d.plan.sets} × {d.plan.reps} · {d.plan.frequency_per_week}/week</span></div>
                <label className="flex items-center justify-between gap-2"><span className="text-mute">Target ROM</span>
                  <span className="flex items-center gap-2"><input className="field w-20" type="number" value={target ?? ''} onChange={(e) => setTarget(Number(e.target.value))} /><span>°</span>
                    <button className="btn px-2 py-1 text-xs" disabled={busy || target === d.plan.target_rom} onClick={savePlan}>Save</button></span>
                </label>
                {d.planChanges.slice(0, 3).map((c) => (
                  <div key={c.id} className="rounded-md bg-ink-800/60 p-2 text-xs">
                    <div className="text-violet">{c.created_by} · {timeAgo(c.created_at)}</div>
                    <div>{Object.entries(c.change).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v.from} → ${v.to}`).join(', ')}</div>
                    <div className="text-mute">{c.rationale}</div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-mute">No active plan.</p>}
          </Section>

          <Section title="Alerts">
            {!d.alerts.length && <p className="text-sm text-mute">No alerts.</p>}
            <ul className="space-y-2">
              {d.alerts.slice(0, 6).map((al) => (
                <li key={al.id} className="flex gap-2 text-sm">
                  <SeverityDot severity={al.severity} />
                  <div className="min-w-0">
                    <div className={al.status === 'open' ? '' : 'text-mute line-through'}>{al.title}</div>
                    <div className="text-[11px] text-mute">{al.status} · {timeAgo(al.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Progress notes">
            <div className="flex gap-2">
              <input className="field flex-1" placeholder="Add a clinician note" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveNote()} />
              <button className="btn" disabled={busy || !note.trim()} onClick={saveNote}>Add</button>
            </div>
            <ul className="mt-3 max-h-80 space-y-2 overflow-auto">
              {d.notes.map((n) => (
                <li key={n.id} className="rounded-md bg-ink-800/50 p-2.5 text-sm">
                  <div className="text-[11px]" style={{ color: n.author.startsWith('agent:') ? '#A78BFA' : '#4FD1C5' }}>{n.author} · {timeAgo(n.created_at)}</div>
                  <p className="mt-0.5 text-paper/90">{n.note}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
