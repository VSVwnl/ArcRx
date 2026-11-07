import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, setApiRole, type Me, type PatientSummary, type Role } from './lib/api';
import { informer, isDevPlatform, isLocalMirror } from './lib/informer';
import PatientHome from './views/PatientHome';
import ClinicianDashboard from './views/ClinicianDashboard';
import AskView from './views/AskView';
import AgentsView from './views/AgentsView';
import SignIn from './views/SignIn';
import { Spinner } from './components/ui';

type Tab = 'session' | 'clinic' | 'ask' | 'agents';

// `role` is the view the tab represents (the dev servers let the UI act as that
// role); `roles` is who may see it. Clinicians can run an exercise session too,
// so a therapist can demonstrate the camera flow with a patient in the room.
const TABS: Array<{ id: Tab; label: string; role: Role; roles: string[] }> = [
  { id: 'session', label: 'Exercise', role: 'patient', roles: ['patient', 'clinician', 'admin'] },
  { id: 'clinic', label: 'Clinic', role: 'clinician', roles: ['clinician', 'admin'] },
  { id: 'ask', label: 'Ask', role: 'clinician', roles: ['clinician', 'admin'] },
  { id: 'agents', label: 'Agents', role: 'clinician', roles: ['clinician', 'admin'] },
];

export default function App() {
  const ctx = informer();
  const dev = isDevPlatform();
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = probing, null = signed out
  const [meError, setMeError] = useState<string | null>(null);

  const probe = useCallback(() => {
    setMeError(null);
    api.me()
      .then((m) => setMe(m))
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setMe(null);
        else { setMe(null); setMeError(e.message); }
      });
  }, []);
  useEffect(probe, [probe]);

  if (me === undefined) return <div className="flex min-h-full items-center justify-center"><Spinner label="Opening ArcRx" /></div>;
  if (me === null) {
    return (
      <div className="flex min-h-full flex-col">
        {meError && <div className="mx-auto mt-4 w-full max-w-5xl px-4"><div className="rounded-md border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">Could not reach the app: {meError}</div></div>}
        <SignIn onDone={probe} />
        <Footer />
      </div>
    );
  }

  // In the dev servers the injected mock roles decide the views; on Informer the session does.
  const roles = dev ? ctx.roles : me.roles;
  const displayName = me.user?.name || ctx.user.displayName || 'Signed in';
  const selfKey = me.user?.username || me.user?.id || me.user?.email || null;
  return <Shell roles={roles} displayName={displayName} selfKey={selfKey} canLogout={!dev && me.user?.issuer === 'local'} onLogout={async () => { await api.logout(); setMe(null); }} />;
}

function Shell({ roles, displayName, selfKey, canLogout, onLogout }: { roles: string[]; displayName: string; selfKey: string | null; canLogout: boolean; onLogout: () => void }) {
  const ctx = informer();
  const visibleTabs = TABS.filter((t) => t.roles.some((r) => roles.includes(r)));
  const [tab, setTab] = useState<Tab>(visibleTabs[0]?.id || 'session');
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

  const where = isLocalMirror() ? 'Offline workspace' : ctx.platform?.version === 'dev' ? 'Informer dev' : 'Informer';

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:gap-6">
          <div className="flex items-center gap-2.5">
            <Mark />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">ArcRx</div>
              <div className="hidden text-[11px] text-mute sm:block">Webcam rehab coach</div>
            </div>
          </div>
          <nav className="hidden gap-1 sm:flex" aria-label="Sections">
            {visibleTabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} className={`rounded-md px-3 py-1.5 text-sm ${tab === t.id ? 'bg-ink-800 text-paper' : 'text-mute hover:text-paper'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-mute sm:gap-3">
            <span className="hidden md:inline">{role === 'patient' ? 'Patient view' : 'Clinician view'} · {displayName}</span>
            <span className="rounded-full border border-ink-700 px-2 py-0.5">{where}</span>
            {canLogout && <button className="text-mute underline-offset-2 hover:text-paper hover:underline" onClick={onLogout}>Sign out</button>}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-20 pt-5 sm:pb-5">
        {error && <div className="mb-4 rounded-md border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">Could not reach the app workspace: {error}</div>}
        {!patients ? <Spinner label="Opening the workspace" /> : (
          <>
            {tab === 'session' && <PatientHome patients={patients} refresh={refresh} selfKey={selfKey} canAdd={roles.includes('clinician') || roles.includes('admin')} />}
            {tab === 'clinic' && <ClinicianDashboard patients={patients} refresh={refresh} version={version} />}
            {tab === 'ask' && <AskView />}
            {tab === 'agents' && <AgentsView refresh={refresh} />}
          </>
        )}
      </main>

      {/* Phone navigation: a bottom tab bar instead of the header row. */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid border-t border-ink-700 bg-ink-950/95 backdrop-blur sm:hidden" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 1fr)`, paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Sections">
        {visibleTabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} className={`min-h-12 text-sm ${tab === t.id ? 'text-paper' : 'text-mute'}`}>
            <span className={`block border-t-2 pt-2.5 ${tab === t.id ? 'border-teal' : 'border-transparent'}`}>{t.label}</span>
          </button>
        ))}
      </nav>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink-800 px-4 py-2 pb-16 text-center text-[11px] text-mute sm:pb-2">
      Computer vision runs entirely in the browser (MediaPipe). Only scored telemetry reaches the Informer workspace. Not a medical device.
    </footer>
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
