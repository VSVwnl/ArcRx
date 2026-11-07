import { useCallback, useEffect, useState } from 'react';
import { api, setApiRole, type PatientSummary, type Role } from './lib/api';
import { informer, isLocalMirror } from './lib/informer';
import PatientHome from './views/PatientHome';
import ClinicianDashboard from './views/ClinicianDashboard';
import AskView from './views/AskView';
import AgentsView from './views/AgentsView';
import { Spinner } from './components/ui';

type Tab = 'session' | 'clinic' | 'ask' | 'agents';

const TABS: Array<{ id: Tab; label: string; role: Role }> = [
  { id: 'session', label: 'Exercise', role: 'patient' },
  { id: 'clinic', label: 'Clinic', role: 'clinician' },
  { id: 'ask', label: 'Ask', role: 'clinician' },
  { id: 'agents', label: 'Agents', role: 'clinician' },
];

export default function App() {
  const ctx = informer();
  const [tab, setTab] = useState<Tab>('session');
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const role: Role = TABS.find((t) => t.id === tab)!.role;
  setApiRole(role);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    setApiRole(role);
    api.patients().then((p) => { setPatients(p); setError(null); }).catch((e) => setError(e.message));
  }, [version, role]);

  const visibleTabs = TABS.filter((t) => ctx.roles.includes(t.role) || ctx.roles.includes('admin'));

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <Mark />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">ArcRx</div>
              <div className="text-[11px] text-mute">Webcam rehab coach</div>
            </div>
          </div>
          <nav className="flex gap-1">
            {visibleTabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t.id ? 'bg-ink-800 text-paper' : 'text-mute hover:text-paper'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-mute">
            <span className="hidden sm:inline">{role === 'patient' ? 'Patient view' : 'Clinician view'} · {ctx.user.displayName}</span>
            <span className="rounded-full border border-ink-700 px-2 py-0.5">{isLocalMirror() ? 'Offline workspace' : ctx.platform?.version === 'dev' ? 'Informer dev' : ctx.report.name}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
        {error && <div className="mb-4 rounded-md border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">Could not reach the app workspace: {error}</div>}
        {!patients ? <Spinner label="Opening the workspace" /> : (
          <>
            {tab === 'session' && <PatientHome patients={patients} refresh={refresh} />}
            {tab === 'clinic' && <ClinicianDashboard patients={patients} refresh={refresh} version={version} />}
            {tab === 'ask' && <AskView />}
            {tab === 'agents' && <AgentsView refresh={refresh} />}
          </>
        )}
      </main>
      <footer className="border-t border-ink-800 px-4 py-2 text-center text-[11px] text-mute">
        Computer vision runs entirely in the browser (MediaPipe). Only scored telemetry reaches the Informer workspace. Not a medical device.
      </footer>
    </div>
  );
}

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#10192D" stroke="#243150" />
      <path d="M14 44 A20 20 0 0 1 50 44" fill="none" stroke="#4FD1C5" strokeWidth="5" strokeLinecap="round" />
      <path d="M32 44 L46 24" stroke="#F5B942" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="44" r="4" fill="#EEF2FF" />
    </svg>
  );
}
