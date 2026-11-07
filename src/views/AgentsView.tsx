import { useCallback, useEffect, useRef, useState } from 'react';
import { load as loadYaml } from 'js-yaml';
import manifestRaw from '../../informer.yaml?raw';
import { api, type AgentInfo, type AgentRun, type AgentRunRow, type AgentStep } from '../lib/api';
import { isDevPlatform } from '../lib/informer';
import { Section, Spinner, timeAgo } from '../components/ui';

// The agent roster comes from informer.yaml itself (bundled at build time), so
// the console describes exactly what was deployed. Runs come from the audit
// rows the tools write, identical on Informer and in the dev servers.
function agentsFromManifest(): AgentInfo[] {
  try {
    const m = loadYaml(manifestRaw) as { agents?: Record<string, { description?: string; model?: string; tools?: string[]; on?: string | string[]; cron?: string }> };
    return Object.entries(m.agents || {}).map(([name, a]) => ({
      name, description: a.description?.trim() || null, model: a.model || 'go_everyday', tools: a.tools || [], on: a.on || [], cron: a.cron || null,
    }));
  } catch {
    return [];
  }
}

export default function AgentsView({ refresh }: { refresh: () => void }) {
  const dev = isDevPlatform();
  const [agents, setAgents] = useState<AgentInfo[]>(() => agentsFromManifest());
  const [runs, setRuns] = useState<AgentRunRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<AgentRun | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const loadRuns = useCallback(() => api.agentRuns({ limit: 20 }).then(setRuns).catch(() => setRuns([])), []);

  useEffect(() => {
    loadRuns();
    if (dev) api.agents().then((list) => setAgents((cur) => cur.map((a) => ({ ...a, mode: list.find((x) => x.name === a.name)?.mode })))).catch(() => {});
    return () => { if (pollTimer.current) window.clearTimeout(pollTimer.current); };
  }, [dev, loadRuns]);

  // On Informer a trigger is queued and runs asynchronously: poll the audit log
  // until a run newer than the trigger shows up (or 45 s pass).
  const waitForNewRun = (since: string, name: string) => {
    const deadline = Date.now() + 45_000;
    const tick = async () => {
      const list = await api.agentRuns({ limit: 10 }).catch(() => [] as AgentRunRow[]);
      const fresh = list.find((r) => r.ended_at > since && (r.agent === name || r.trigger_event === '_manual' || r.trigger_event === '_cron'));
      if (fresh) {
        setRuns(list);
        setLast({ agent: fresh.agent, trigger: fresh.trigger_event, status: fresh.status, steps: fresh.steps, summary: fresh.summary || undefined, mode: 'Informer AI' });
        setNotice(null);
        setBusy(null);
        refresh();
        return;
      }
      if (Date.now() < deadline) pollTimer.current = window.setTimeout(tick, 2500);
      else { setBusy(null); setNotice(`${name} was queued on Informer; its tool calls will appear in the log when it finishes.`); loadRuns(); }
    };
    pollTimer.current = window.setTimeout(tick, 2500);
  };

  const run = async (name: string) => {
    setBusy(name);
    setNotice(null);
    try {
      if (dev) {
        const r = await api.triggerAgent(name, name === 'weekly_caseload_report' ? 'cron' : '_manual', {});
        setLast(r);
        refresh();
        await loadRuns();
        setBusy(null);
      } else {
        const since = new Date().toISOString();
        await api.triggerAgentOnPlatform(name);
        setNotice(`${name} is running on Informer…`);
        waitForNewRun(since, name);
      }
    } catch (err) {
      setNotice((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Agents</h2>
        <p className="text-sm text-mute">Declared in informer.yaml, executed with the tools in tools/. Every tool call is recorded below.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((a) => (
          <div key={a.name} className="panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-mute">{a.cron ? `cron ${a.cron}` : `on ${Array.isArray(a.on) ? a.on.join(', ') : a.on}`} · model {a.model}</div>
              </div>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ background: a.mode === 'llm' ? 'rgba(167,139,250,0.18)' : 'rgba(79,209,197,0.14)', color: a.mode === 'llm' ? '#A78BFA' : '#4FD1C5' }}>
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
      </div>
      {notice && <div className="rounded-md border border-ink-700 bg-ink-800/50 px-3 py-2 text-sm text-paper/85">{notice}</div>}

      {last && (
        <Section title={`Last run · ${last.agent}`} aside={<span className="text-xs text-mute">{last.mode}{last.durationMs ? ` · ${last.durationMs} ms` : ''}</span>}>
          {last.summary && <p className="mb-2 text-sm text-paper/85">{last.summary}</p>}
          <Steps steps={last.steps} />
        </Section>
      )}

      <Section title="Run log">
        {runs === null && <Spinner label="Loading runs" />}
        {runs?.length === 0 && <p className="text-sm text-mute">No runs recorded yet. Finish a session to trigger rehab_triage.</p>}
        <ul className="space-y-2">
          {runs?.map((r) => (
            <li key={r.id}>
              <details className="rounded-md border border-ink-700 bg-ink-800/40 p-3">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">{r.agent}</span> <span className="text-mute">on {r.trigger_event} · {timeAgo(r.ended_at)}{r.status !== 'completed' ? ' · with errors' : ''}</span>
                  {r.summary && <div className="mt-0.5 text-xs text-paper/80">{r.summary}</div>}
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
              <div key={j} className="min-w-0">
                <span className="text-violet">{c.name}</span>
                <span className="break-all text-mute">({JSON.stringify(c.args).slice(0, 140)})</span>
                <div className="truncate text-teal">→ {JSON.stringify(c.result).slice(0, 180)}</div>
              </div>
            ))
          )}
        </li>
      ))}
    </ol>
  );
}
