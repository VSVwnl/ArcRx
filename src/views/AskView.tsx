import { useState } from 'react';
import { api, type AskResult } from '../lib/api';
import { DataTable, MiniBars, MiniLine, Spinner } from '../components/ui';

const SUGGESTIONS = [
  'Who regressed this week?',
  'Who is missing sessions?',
  'Who has plateaued?',
  'Show compensation by patient',
  'How is Priya doing?',
  'Who is ready to progress?',
];

interface Turn { q: string; a?: AskResult; error?: string }

export default function AskView() {
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setQ('');
    setTurns((t) => [{ q: question }, ...t]);
    try {
      const a = await api.ask(question);
      setTurns((t) => t.map((x, i) => (i === 0 ? { ...x, a } : x)));
    } catch (err) {
      setTurns((t) => t.map((x, i) => (i === 0 ? { ...x, error: (err as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Ask your rehab data</h2>
        <p className="text-sm text-mute">Questions run against the app's private workspace: patients, plans, sessions, reps, alerts and notes. Answers are scoped to what your role may see.</p>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="field flex-1 text-base" placeholder="e.g. which patients dropped more than 10% this week?" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !q.trim()}>Ask</button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => <button key={s} className="btn btn-ghost border border-ink-700 px-2.5 py-1 text-xs" onClick={() => ask(s)}>{s}</button>)}
      </div>

      <div className="space-y-4">
        {turns.map((t, i) => (
          <div key={i} className="panel p-4">
            <div className="text-sm text-mute">{t.q}</div>
            {!t.a && !t.error && <div className="mt-2"><Spinner label="Querying the workspace" /></div>}
            {t.error && <p className="mt-2 text-sm text-coral">{t.error}</p>}
            {t.a && (
              <div className="mt-2 space-y-3">
                <p className="text-base leading-relaxed">{t.a.answer}</p>
                {t.a.highlights.length > 0 && (
                  <ul className="space-y-1 text-sm text-paper/80">
                    {t.a.highlights.map((h, j) => <li key={j} className="border-l-2 border-amber/60 pl-2">{h}</li>)}
                  </ul>
                )}
                {t.a.chart && t.a.chart.data.length > 0 && (
                  t.a.chart.type === 'line' ? <MiniLine data={t.a.chart.data} height={160} /> : <MiniBars data={t.a.chart.data} height={160} />
                )}
                {t.a.table && t.a.table.rows.length > 0 && <DataTable columns={t.a.table.columns} rows={t.a.table.rows} />}
                <div className="flex items-center gap-2 text-[11px] text-mute">
                  <span className="rounded-full px-2 py-0.5" style={{ background: t.a.mode === 'ai' ? 'rgba(167,139,250,0.18)' : 'rgba(79,209,197,0.14)', color: t.a.mode === 'ai' ? '#A78BFA' : '#4FD1C5' }}>
                    {t.a.mode === 'ai' ? 'Model-drafted SQL, validated read-only' : 'Deterministic query'}
                  </span>
                  {t.a.sql && <code className="truncate font-mono">{t.a.sql}</code>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
