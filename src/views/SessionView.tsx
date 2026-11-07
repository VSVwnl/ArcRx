import { useEffect, useRef, useState } from 'react';
import { useSessionEngine, type Source } from '../cv/useSessionEngine';
import { COMPENSATION_LABELS, EXERCISE_SPECS, type ExerciseKey, type Side } from '../cv/types';
import { api, type AgentRun, type Assessment, type PatientSummary } from '../lib/api';
import { isDevPlatform } from '../lib/informer';
import { StatusPill } from '../components/ui';

interface Props {
  patient: PatientSummary;
  onSaved: () => void;
}

type Outcome = { assessment: Assessment; sessionId: number; agent: AgentRun | null; agentError?: string };

export default function SessionView({ patient, onSaved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state, start, stop, setSim } = useSessionEngine(videoRef, canvasRef);
  const plan = patient.plan;
  const [exercise, setExercise] = useState<ExerciseKey>((plan?.exercise_key as ExerciseKey) || 'shoulder_abduction');
  const [side, setSide] = useState<Side>(plan?.side || 'right');
  const [target, setTarget] = useState<number>(plan?.target_rom || EXERCISE_SPECS[exercise].normalRom * 0.8);
  const [source, setSource] = useState<Source>('webcam');
  const [pain, setPain] = useState(2);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simPeak, setSimPeak] = useState(0);

  useEffect(() => {
    setExercise((plan?.exercise_key as ExerciseKey) || 'shoulder_abduction');
    setSide(plan?.side || 'right');
    setTarget(plan?.target_rom || 120);
    setOutcome(null);
  }, [patient.id, plan?.exercise_key, plan?.side, plan?.target_rom]);

  const spec = EXERCISE_SPECS[exercise];
  const running = state.status === 'calibrating' || state.status === 'tracking';
  const pct = Math.max(0, Math.min(1.25, state.angle / target));
  const activeFlags = Object.entries(state.flags).filter(([, v]) => v).map(([k]) => k);

  const begin = async (src: Source) => {
    setError(null);
    setOutcome(null);
    setSource(src);
    try {
      await start({ exercise, side, targetRom: target, source: src });
      if (src === 'simulation') setSimPeak(Math.round(Math.min(spec.normalRom - 5, target * 0.88)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const finish = async () => {
    if (!state.reps.length) {
      setError('No reps were counted yet. Complete at least one full movement before finishing.');
      return;
    }
    stop();
    setSaving(true);
    setError(null);
    try {
      const startedAt = state.startedAt || new Date().toISOString();
      const saved = await api.saveSession({
        patient_id: patient.id, exercise_key: exercise, side, started_at: startedAt, ended_at: new Date().toISOString(),
        pain_score: pain, source, reps: state.reps,
      });
      const out: Outcome = { assessment: saved.assessment, sessionId: saved.session.session_id, agent: null };
      setOutcome(out);
      // Informer dispatches `on: session.completed` agents itself in production;
      // the dev surfaces (official plugin and local mirror) expose a manual trigger.
      if (isDevPlatform()) {
        try {
          out.agent = await api.triggerAgent('rehab_triage', 'session.completed', saved.session);
        } catch (err) {
          out.agentError = (err as Error).message;
        }
        setOutcome({ ...out });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
      {/* Stage */}
      <div className="relative overflow-hidden rounded-xl border border-ink-700 bg-ink-950" style={{ aspectRatio: '16 / 9' }}>
        {source === 'simulation' && <div className="sim-backdrop absolute inset-0" />}
        <video ref={videoRef} className={`absolute inset-0 h-full w-full object-cover video-mirror ${source === 'webcam' ? '' : 'hidden'}`} playsInline muted />
        <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${source === 'webcam' ? 'video-mirror' : ''}`} />
        <div className="scanline pointer-events-none absolute inset-0 opacity-60" />

        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-full bg-ink-900/85 px-3 py-1 text-xs backdrop-blur">
            <span className={`h-2 w-2 rounded-full ${running ? 'bg-amber live-dot' : 'bg-ink-600'}`} />
            {running ? (source === 'webcam' ? 'Live camera · frames stay on this laptop' : 'Demo simulation') : 'Camera off'}
            {running && <span className="text-mute">· {state.fps} fps</span>}
          </span>
        </div>

        {state.status === 'idle' && !outcome && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-sm text-sm text-mute">{spec.cue}</p>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => begin('webcam')}>Start camera</button>
              <button className="btn" onClick={() => begin('simulation')}>Demo simulation</button>
            </div>
            <p className="text-xs text-mute">Video never leaves the browser. Only the scored angles are saved.</p>
          </div>
        )}
        {state.status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-mute">{state.statusText}…</div>
        )}
        {state.status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="max-w-md text-sm text-coral">{state.statusText}</p>
            <button className="btn btn-primary" onClick={() => begin('simulation')}>Use Demo simulation</button>
          </div>
        )}
        {running && (
          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
            <div className="rounded-md bg-ink-900/85 px-3 py-2 text-sm backdrop-blur">
              {state.status === 'calibrating' ? state.statusText : state.inFrame ? state.statusText : state.statusText}
            </div>
            <div className="numeral rounded-md bg-ink-900/85 px-3 py-1 text-right backdrop-blur">
              <div className="text-3xl font-semibold" style={{ color: activeFlags.length ? '#F0636B' : '#F5B942' }}>
                {state.angle.toFixed(0)}<span className="text-base text-mute">°</span>
              </div>
              <div className="text-[11px] text-mute">rep {state.reps.length + (state.phase !== 'rest' ? 1 : 0)} · peak {state.repPeak.toFixed(0)}°</div>
            </div>
          </div>
        )}
      </div>

      {/* Instrument column */}
      <div className="flex flex-col gap-3">
        <div className="panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-mute">Prescribed for {patient.name.split(' ')[0]}</div>
              <div className="mt-0.5 text-lg font-semibold">{spec.label} · {side}</div>
            </div>
            <StatusPill status={patient.assessment.status} label={patient.assessment.statusLabel} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <label className="flex flex-col gap-1 text-xs text-mute">Exercise
              <select className="field" value={exercise} disabled={running} onChange={(e) => setExercise(e.target.value as ExerciseKey)}>
                {Object.values(EXERCISE_SPECS).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-mute">Side
              <select className="field" value={side} disabled={running} onChange={(e) => setSide(e.target.value as Side)}>
                <option value="right">Right</option><option value="left">Left</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-mute">Target °
              <input className="field" type="number" min={10} max={180} value={target} disabled={running} onChange={(e) => setTarget(Number(e.target.value))} />
            </label>
          </div>
        </div>

        <div className="panel p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-mute">Range of motion</span>
            <span className="text-xs text-mute">{plan ? `${plan.sets} × ${plan.reps} reps` : ''}</span>
          </div>
          <div className="numeral mt-1 flex items-baseline gap-2">
            <span className="text-6xl font-semibold leading-none" style={{ color: running ? '#F5B942' : '#8A96B3' }}>{state.angle.toFixed(0)}°</span>
            <span className="text-sm text-mute">of {target}° target</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-800">
            <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${Math.min(100, pct * 100)}%`, background: pct >= 1 ? '#4FD1C5' : '#F5B942' }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {spec.compensations.map((k) => (
              <span key={k} className="rounded-full px-2 py-0.5 text-xs" style={{ background: state.flags[k] ? 'rgba(240,99,107,0.2)' : 'rgba(138,150,179,0.12)', color: state.flags[k] ? '#F0636B' : '#8A96B3' }}>
                {COMPENSATION_LABELS[k]}
              </span>
            ))}
          </div>
        </div>

        <div className="panel flex-1 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-mute">Reps this session</span>
            <span className="numeral text-sm">{state.reps.length}</span>
          </div>
          <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-sm">
            {state.reps.slice().reverse().slice(0, 8).map((r) => (
              <li key={r.index} className="flex items-center justify-between rounded-md bg-ink-800/60 px-2 py-1">
                <span className="text-mute">#{r.index}</span>
                <span className="numeral font-medium" style={{ color: r.peak_angle >= target ? '#4FD1C5' : '#EEF2FF' }}>{r.peak_angle.toFixed(0)}°</span>
                <span className="text-xs text-mute">{(r.duration_ms / 1000).toFixed(1)}s · smooth {r.smoothness.toFixed(0)}</span>
                <span className="text-xs" style={{ color: r.compensation_flags.length ? '#F0636B' : '#4FD1C5' }}>
                  {r.compensation_flags.length ? r.compensation_flags.map((f) => COMPENSATION_LABELS[f]).join(', ') : 'clean'}
                </span>
              </li>
            ))}
            {!state.reps.length && <li className="text-xs text-mute">Reps appear here as you complete full movements.</li>}
          </ul>
        </div>

        {running && source === 'simulation' && (
          <div className="panel p-3 text-xs text-mute">
            <div className="flex items-center justify-between"><span>Simulated patient reaches</span><span className="numeral text-paper">{simPeak}°</span></div>
            <input type="range" min={20} max={spec.normalRom} value={simPeak} className="mt-1 w-full accent-amber" onChange={(e) => { setSimPeak(Number(e.target.value)); setSim({ peakRom: Number(e.target.value) }); }} />
            <div className="mt-1 flex gap-2">
              <button className="btn btn-ghost px-2 py-1" onClick={() => setSim({ compensateEvery: 3 })}>Compensate every 3rd rep</button>
              <button className="btn btn-ghost px-2 py-1" onClick={() => setSim({ compensateEvery: 1 })}>Every rep</button>
              <button className="btn btn-ghost px-2 py-1" onClick={() => setSim({ compensateEvery: 0 })}>Clean form</button>
            </div>
          </div>
        )}

        <div className="panel p-4">
          <label className="flex items-center justify-between text-xs text-mute">
            <span>Pain during the set (0–10)</span>
            <span className="numeral text-base text-paper">{pain}</span>
          </label>
          <input type="range" min={0} max={10} value={pain} className="mt-1 w-full accent-amber" onChange={(e) => setPain(Number(e.target.value))} />
          <div className="mt-3 flex gap-2">
            {running ? (
              <>
                <button className="btn btn-teal flex-1" onClick={finish} disabled={saving}>{saving ? 'Saving…' : 'Finish & save session'}</button>
                <button className="btn" onClick={stop}>Stop</button>
              </>
            ) : (
              <>
                <button className="btn btn-primary flex-1" onClick={() => begin('webcam')} disabled={saving}>Start camera</button>
                <button className="btn" onClick={() => begin('simulation')} disabled={saving}>Demo simulation</button>
              </>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-coral">{error}</p>}
        </div>

        {outcome && <OutcomeCard outcome={outcome} />}
      </div>
    </div>
  );
}

function OutcomeCard({ outcome }: { outcome: Outcome }) {
  const a = outcome.assessment;
  const calls = outcome.agent?.steps.flatMap((s) => s.toolCalls || []) || [];
  const alert = calls.find((c) => c.name === 'create_alert' && (c.result as { alert_id?: number })?.alert_id);
  const note = calls.find((c) => c.name === 'write_progress_note');
  const plan = calls.find((c) => c.name === 'adjust_plan' && (c.result as { changed?: boolean })?.changed);
  return (
    <div className="panel border-violet/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-violet">Session saved · triage agent</span>
        <StatusPill status={a.status} label={a.statusLabel} />
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {a.reasons.map((r, i) => <li key={i} className="text-paper/90">{r}</li>)}
      </ul>
      {outcome.agent ? (
        <div className="mt-3 space-y-1.5 text-xs">
          <div className="text-mute">Agent ran {calls.length} tool calls in {outcome.agent.durationMs ?? '—'} ms ({outcome.agent.mode === 'llm' ? 'Claude' : 'deterministic plan'})</div>
          {alert && <div className="rounded-md bg-coral/15 px-2 py-1 text-coral">Alert raised: {String((alert.args as { title?: string }).title)}</div>}
          {plan && <div className="rounded-md bg-teal/15 px-2 py-1 text-teal">Plan progressed: {JSON.stringify((plan.result as { change?: unknown }).change)}</div>}
          {note && <div className="rounded-md bg-ink-800 px-2 py-1 text-paper/80">Progress note written to the chart.</div>}
        </div>
      ) : outcome.agentError ? (
        <p className="mt-2 text-xs text-coral">Agent trigger failed: {outcome.agentError}</p>
      ) : (
        <p className="mt-2 text-xs text-mute">Informer will run the rehab_triage agent on this session.</p>
      )}
    </div>
  );
}
