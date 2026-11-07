import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';

// Shown on the public app when no session exists. Accounts are the app's own
// (Informer holds the credentials); tenant users can use their Informer login.
export default function SignIn({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await api.signup(email.trim(), password, name.trim() || email.split('@')[0]);
      else await api.login(email.trim(), password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-8 lg:grid-cols-[1.2fr_minmax(320px,400px)] lg:py-16">
      <section className="space-y-5">
        <p className="text-xs text-teal">Triangle AI Hackathon 2026 · built on Informer Apps</p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          A webcam goniometer with a physical therapist's judgment in the loop.
        </h1>
        <p className="max-w-prose text-paper/85">
          ArcRx measures every rehab rep in the browser, scores range, smoothness and the compensation patterns
          therapists watch for, and lets an Informer agent triage each session. Video never leaves your device.
        </p>
        <ul className="grid gap-2 text-sm text-paper/80 sm:grid-cols-2">
          <li className="panel p-3"><span className="text-amber">Measure</span> joint angles live from the camera, or run the demo simulation.</li>
          <li className="panel p-3"><span className="text-coral">Catch compensation</span> such as trunk lean and shoulder hike on every rep.</li>
          <li className="panel p-3"><span className="text-violet">Agents</span> raise alerts, progress plans within guard rails and write notes.</li>
          <li className="panel p-3"><span className="text-teal">Ask the caseload</span> questions in plain language over governed data.</li>
        </ul>
        <p className="text-xs text-mute">Demo workspace with four synthetic patients. New accounts open as a clinician. Not a medical device.</p>
      </section>

      <section className="panel self-start p-5">
        <div className="mb-4 grid grid-cols-2 rounded-md bg-ink-800 p-1 text-sm">
          <button type="button" onClick={() => setMode('signup')} className={`rounded px-3 py-1.5 ${mode === 'signup' ? 'bg-ink-950 text-paper' : 'text-mute'}`}>Create account</button>
          <button type="button" onClick={() => setMode('login')} className={`rounded px-3 py-1.5 ${mode === 'login' ? 'bg-ink-950 text-paper' : 'text-mute'}`}>Sign in</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <label className="block text-sm">
              <span className="text-mute">Your name</span>
              <input className="field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Dr. Okafor" />
            </label>
          )}
          <label className="block text-sm">
            <span className="text-mute">Email</span>
            <input className="field mt-1 w-full" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
          </label>
          <label className="block text-sm">
            <span className="text-mute">Password</span>
            <input className="field mt-1 w-full" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </label>
          {error && <div role="alert" className="rounded-md border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">{error}</div>}
          <button className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'One moment…' : mode === 'signup' ? 'Create account and open ArcRx' : 'Sign in'}
          </button>
        </form>
        <div className="my-4 flex items-center gap-3 text-xs text-mute"><span className="h-px flex-1 bg-ink-700" />or<span className="h-px flex-1 bg-ink-700" /></div>
        <a className="btn w-full justify-center py-2.5 text-center" href="/_auth/informer">Sign in with Informer</a>
      </section>
    </div>
  );
}
