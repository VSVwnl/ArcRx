import { useEffect, useState } from 'react';
import { api, type AgentInfo, type AgentRun, type AgentRunRow, type AgentStep } from '../lib/api';
import { isDevPlatform } from '../lib/informer';
import { Section, Spinner, timeAgo } from '../components/ui';

export default function AgentsView({ refresh }: { refresh: () => void }) {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<AgentRun | null>(null);
  const dev = isDevPlatform();

  const load = () => {
    if (dev) api.agents().then(setAgents).catch(() => setAgents([]));
    else setAgents([]);
    api.agentRuns().then(setRuns).catch(() => {});
  };
  useEffect(load, [dev]);

  const run = async (name: string) => {
    setBusy(name);
    try {
      const r = await api.triggerAgent(name, name === 'weekly_caseload_report' ? 'cron' : '_manual', {});
      setLast(r);
      refresh();
      load();
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Agents</h2>
        <p className="text-sm text-mute">Declared in informer.yaml, executed with the tools in tools/. Every tool call is auditable below.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {agents === null && <Spinner label="Loading agents" />}
        {agents?.map((a) => (
          <div key={a.name} className="panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-mute">{a.cron ? `cron ${a.cron}` : `on ${Array.isArray(a.on) ? a.on.join(', ') : a.on}`} · model {a.model}</div>
              </div>
              <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: a.mode === 'llm' ? 'rgba(167,139,250,0.18)' : 'rgba(79,209,197,0.14)', color: a.mode === 'llm' ? '#A78BFA' : '#4FD1C5' }}>
                {a.mode === 'llm' ? 'LLM loop' : a.mode === 'fallback' ? 'offline plan' : 'Informer AI'}
              </span>
            </div>
            <p className="mt-2 text-sm text-paper/85">{a.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {a.tools.map((t) => <code key={t} className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-mute">{t}</code>)}
            </div>
            <button className="btn mt-3" disabled={busy !== null} onClick={() => run(a.name)}>{busy === a.name ? 'Running…' : 'Run now'}</button>
          </div>
        ))}
        {agents?.length === 0 && <p className="text-sm text-mute">Agent triggers are available in the dev server; in production Informer runs them on events and schedules.</p>}
      </div>

      {last && (
        <Section title={`Last run · ${last.agent}`} aside={<span className="text-xs text-mute">{last.mode} · {last.durationMs} ms</span>}>
          <Steps steps={last.steps} />
        </Section>
      )}

      <Section title="Run log">
        {!runs.length && <p className="text-sm text-mute">No runs recorded yet. Finish a session to trigger rehab_triage.</p>}
        <ul className="space-y-2">
          {runs.map((r) => (
            <li key={r.id}>
              <details className="rounded-md border border-ink-700 bg-ink-800/40 p-3">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">{r.agent}</span> <span className="text-mute">on {r.trigger_event} · {timeAgo(r.created_at)}</span>
                  <div className="mt-0.5 text-xs text-paper/80">{r.summary}</div>
                </summary>
                <div className="mt-2"><Steps steps={r.steps} /></div>
              </details>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Steps({ steps }: { steps: AgentStep[] }) {
  return (
    <ol className="space-y-1.5 text-xs">
      {steps.map((s, i) => (
        <li key={i} className="rounded-md bg-ink-950/60 p-2 font-mono">
          {s.type === 'text' ? (
            <span className="text-paper/85">{s.text}</span>
          ) : (
            s.toolCalls?.map((c, j) => (
              <div key={j}>
                <span className="text-violet">{c.name}</span>
                <span className="text-mute">({JSON.stringify(c.args).slice(0, 140)})</span>
                <div className="truncate text-teal">→ {JSON.stringify(c.result).slice(0, 180)}</div>
              </div>
            ))
          )}
        </li>
      ))}
    </ol>
  );
}
