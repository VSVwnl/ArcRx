import { useState, type FormEvent } from 'react';
import { api, type NewPatient } from '../lib/api';
import { EXERCISE_SPECS, type ExerciseKey, type Side } from '../cv/types';

// Clinician adds a patient with a first prescription. "This is me" links the
// record to the signed-in account so the person can exercise as themselves.
export default function AddPatientForm({ onCreated, onCancel, canLink }: { onCreated: (id: number) => void; onCancel: () => void; canLink: boolean }) {
  const [name, setName] = useState('');
  const [condition, setCondition] = useState('');
  const [exercise, setExercise] = useState<ExerciseKey>('shoulder_abduction');
  const [side, setSide] = useState<Side>('right');
  const [target, setTarget] = useState<number>(Math.round(EXERCISE_SPECS.shoulder_abduction.normalRom * 0.8));
  const [reps, setReps] = useState(10);
  const [sets, setSets] = useState(3);
  const [freq, setFreq] = useState(5);
  const [linkToMe, setLinkToMe] = useState(canLink);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickExercise = (key: ExerciseKey) => {
    setExercise(key);
    setTarget(Math.round(EXERCISE_SPECS[key].normalRom * 0.8));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: NewPatient = { name, condition, exercise_key: exercise, side, target_rom: target, reps, sets, frequency_per_week: freq, link_to_me: linkToMe, clinic_code: code.trim() };
    try {
      const created = await api.createPatient(payload);
      onCreated(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel space-y-3 p-4" aria-label="Add patient">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Add a patient</h3>
          <p className="text-xs text-mute">A record plus their first prescription. Sessions, triage, alerts and charts start from the first rep.</p>
        </div>
        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={onCancel}>Cancel</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-mute">Name</span>
          <input className="field mt-1 w-full" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" autoComplete="off" />
        </label>
        <label className="block text-sm">
          <span className="text-mute">Condition</span>
          <input className="field mt-1 w-full" required minLength={2} maxLength={160} value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Rotator cuff repair (R), post-op week 4" />
        </label>
        <label className="block text-sm">
          <span className="text-mute">Exercise</span>
          <select className="field mt-1 w-full" value={exercise} onChange={(e) => pickExercise(e.target.value as ExerciseKey)}>
            {Object.values(EXERCISE_SPECS).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-mute">Side</span>
            <select className="field mt-1 w-full" value={side} onChange={(e) => setSide(e.target.value as Side)}>
              <option value="right">Right</option><option value="left">Left</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-mute">Target °</span>
            <input className="field mt-1 w-full" type="number" required min={1} max={180} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <label className="block text-sm"><span className="text-mute">Sets</span><input className="field mt-1 w-full" type="number" min={1} max={10} value={sets} onChange={(e) => setSets(Number(e.target.value))} /></label>
          <label className="block text-sm"><span className="text-mute">Reps</span><input className="field mt-1 w-full" type="number" min={1} max={50} value={reps} onChange={(e) => setReps(Number(e.target.value))} /></label>
          <label className="block text-sm"><span className="text-mute">Days / week</span><input className="field mt-1 w-full" type="number" min={1} max={14} value={freq} onChange={(e) => setFreq(Number(e.target.value))} /></label>
        </div>
      </div>
      <p className="text-xs text-mute">{EXERCISE_SPECS[exercise].cue}</p>
      <label className="block text-sm sm:max-w-xs">
        <span className="text-mute">Clinic code</span>
        <input className="field mt-1 w-full" required maxLength={64} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="From your clinician" />
        <span className="mt-1 block text-xs text-mute">Patients are added only with a code the clinic hands out. Hackathon demo code: 2026.</span>
      </label>
      {canLink && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={linkToMe} onChange={(e) => setLinkToMe(e.target.checked)} />
          This is me: link the record to my account so I can exercise as this patient
        </label>
      )}
      {error && <div role="alert" className="rounded-md border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add patient'}</button>
      </div>
    </form>
  );
}
