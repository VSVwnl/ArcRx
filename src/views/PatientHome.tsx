import { useEffect, useState } from 'react';
import { api, type PatientDetail, type PatientSummary } from '../lib/api';
import { EXERCISE_SPECS, type ExerciseKey } from '../cv/types';
import { fmtDate, MiniLine, Section, Spinner, Stat } from '../components/ui';
import SessionView from './SessionView';
import AddPatientForm from './AddPatientForm';

export default function PatientHome({ patients, refresh, selfKey, canAdd }: { patients: PatientSummary[]; refresh: () => void; selfKey: string | null; canAdd: boolean }) {
  // Default to the signed-in person's own record when one is linked to their account.
  const mine = selfKey ? patients.find((p) => p.username === selfKey) : undefined;
  const [patientId, setPatientId] = useState<number>(mine?.id ?? patients[0]?.id);
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const patient = patients.find((p) => p.id === patientId) || patients[0];

  useEffect(() => {
    if (!patient) return;
    let alive = true;
    api.patient(patient.id).then((d) => alive && setDetail(d)).catch(() => alive && setDetail(null));
    return () => { alive = false; };
  }, [patient?.id, patients]);

  if (adding) {
    return (
      <div className="space-y-4">
        <AddPatientForm canLink={!!selfKey && !mine} onCancel={() => setAdding(false)} onCreated={(id) => { setPatientId(id); setAdding(false); refresh(); }} />
      </div>
    );
  }
  if (!patient) {
    return (
      <div className="panel p-6 text-center">
        <p className="text-sm text-mute">No patients yet.</p>
        {canAdd && <button className="btn btn-primary mt-3" onClick={() => setAdding(true)}>Add the first patient</button>}
      </div>
    );
  }
  const m = patient.assessment.metrics;
  const spec = patient.plan ? EXERCISE_SPECS[patient.plan.exercise_key as ExerciseKey] : null;
  // Only show a record that belongs to the selected patient (never the previous one while loading).
  const mineDetail = detail && detail.patient.id === patient.id ? detail : null;
  const history = (mineDetail?.sessions || []).slice().reverse().slice(-20).map((s) => ({ label: fmtDate(s.started_at), value: s.peak_rom }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Today's exercise</h2>
          <p className="text-sm text-mute">{patient.condition}{spec ? ` · ${spec.label}, ${patient.plan?.side}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-mute">
            Exercising as
            <select className="field" value={patient.id} onChange={(e) => setPatientId(Number(e.target.value))}>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name}{p.username && p.username === selfKey ? ' (me)' : ''}</option>)}
            </select>
          </label>
          {canAdd && <button className="btn px-3 py-1.5 text-xs" onClick={() => setAdding(true)}>Add patient</button>}
        </div>
      </div>

      {/* Keyed by patient: switching patient ends the running session (camera released)
          instead of attributing one patient's reps to another. */}
      <SessionView key={patient.id} patient={patient} onSaved={refresh} />

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Best this week" value={m.sessions ? m.latestPeak.toFixed(0) : '—'} unit={`° of ${m.target}°`} tone="amber" />
        <Stat label="Sessions this week" value={`${m.sessionsLast7} / ${m.prescribedPerWeek}`} tone="teal" />
        <Stat label="Clean reps" value={`${Math.max(0, 100 - m.compensationPct).toFixed(0)}%`} tone={m.compensationPct >= 40 ? 'coral' : 'teal'} />
        <Stat label="Trend" value={`${m.slopePerSession >= 0 ? '+' : ''}${m.slopePerSession.toFixed(1)}`} unit="° / session" tone={m.slopePerSession < 0 ? 'coral' : undefined} />
      </div>

      <Section title="Your range of motion over time">
        {!mineDetail ? <Spinner label="Loading history" /> : history.length ? <MiniLine data={history} height={180} /> : (
          <p className="py-8 text-center text-sm text-mute">No sessions yet. Each saved session adds a point here.</p>
        )}
        <p className="mt-2 text-xs text-mute">Each point is the best rep of a session. Target: {m.target}°.</p>
      </Section>
    </div>
  );
}
