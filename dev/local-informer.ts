// ArcRx offline mirror of the Informer dev server.
//
// The official @entrinsik/vite-plugin-informer only mounts its dev surfaces
// when INFORMER_URL points at a live Informer instance. For judging on a laptop
// with no network, this plugin mounts the SAME surfaces with the SAME handler
// contract so server/, tools/, migrations/ and informer.yaml run unchanged:
//
//   /api/_server/*            file-convention routes from server/ (handler bag:
//                             query, transaction, fetch, emit, notify, email,
//                             log, env, platform, request, respond)
//   /api/_agent               GET lists agents from informer.yaml
//   /api/_agent/:name/_trigger  runs an agent with tools/ (LLM loop when
//                             ANTHROPIC_API_KEY is set, else the agent's
//                             declarative fallback plan from agents/<name>.yaml)
//   /api/models/:id/_object   mirror of Informer AI (503 without a key)
//   window.__INFORMER__       injected into index.html like the real server
//
// The workspace is a real Postgres (PGlite, WASM) persisted under
// .informer-local/, and migrations/ run on boot exactly as on deploy.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { parse as parseUrl, pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { load as loadYaml } from 'js-yaml';
import { PGlite } from '@electric-sql/pglite';
import { aiAvailable, objectCompletion, textCompletion, runAgentLoop, type AgentStep, type LocalTool } from './local-ai.ts';
import { runFallbackPlan, type FallbackPlan } from './fallback-plan.ts';

export interface LocalInformerOptions {
  mock?: { theme?: 'light' | 'dark'; roles?: string[]; user?: { username?: string; displayName?: string }; report?: { id?: string; name?: string } };
  dataDir?: string;
}

type Row = Record<string, unknown>;
type Query = (sql: string, params?: unknown[]) => Promise<Row[]>;

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const CAPABILITIES = {
  serverRoutes: true, webhooks: false, tools: true, mcp: false, agents: true, automations: false,
  messages: true, storage: false, snapshots: false, customApis: false, integrationDependencies: false,
  datasourceDependencies: false, aiCompletions: true, channels: false, channelActors: false,
  embeddings: false, publicAccess: false, accounts: false, cli: false,
};

function filePathToRoute(relPath: string, dirPrefix = 'server'): string {
  let route = relPath.replace(new RegExp(`^${dirPrefix}/`), '').replace(/\.js$/, '');
  route = route.replace(/\[([^\]]+)\]/g, ':$1').replace(/\/index$/, '');
  if (route === 'index' || route === '') return '/';
  if (!route.startsWith('/')) route = '/' + route;
  return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
}

async function walkJsFiles(dir: string, basePath: string): Promise<Array<{ relPath: string; absPath: string }>> {
  const out: Array<{ relPath: string; absPath: string }> = [];
  let items: string[] = [];
  try { items = await readdir(dir); } catch { return out; }
  for (const item of items) {
    const full = join(dir, item);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...(await walkJsFiles(full, `${basePath}/${item}`)));
    else if (item.endsWith('.js')) out.push({ relPath: `${basePath}/${item}`, absPath: full });
  }
  return out;
}

function matchRoute(routes: Array<{ path: string; filePath: string }>, requestPath: string) {
  const normalized = requestPath.length > 1 && requestPath.endsWith('/') ? requestPath.slice(0, -1) : requestPath;
  const segs = normalized.split('/').filter(Boolean);
  let best: { route: { path: string; filePath: string }; params: Record<string, string> } | null = null;
  let bestScore = -1;
  for (const route of routes) {
    const rsegs = route.path.split('/').filter(Boolean);
    if (rsegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let score = 0;
    let ok = true;
    for (let i = 0; i < rsegs.length; i++) {
      if (rsegs[i].startsWith(':')) params[rsegs[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (rsegs[i] === segs[i]) score++;
      else { ok = false; break; }
    }
    if (ok && score > bestScore) { best = { route, params }; bestScore = score; }
  }
  return best;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k.toLowerCase(), v);
  if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json');
  if (body === null || body === undefined) return res.end();
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sendSse(res: ServerResponse, events: unknown[]) {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function buildLog(prefix: string) {
  const call = (level: string, message: unknown, data?: unknown) => {
    const args: unknown[] = [`${prefix} [${level}] ${typeof message === 'string' ? message : JSON.stringify(message)}`];
    if (data !== undefined) args.push(data);
    console.log(...args);
  };
  return Object.assign((m: unknown, d?: unknown) => call('info', m, d), {
    debug: (m: unknown, d?: unknown) => call('debug', m, d),
    info: (m: unknown, d?: unknown) => call('info', m, d),
    warn: (m: unknown, d?: unknown) => call('warn', m, d),
    error: (m: unknown, d?: unknown) => call('error', m, d),
  });
}

export function localInformer(options: LocalInformerOptions = {}): Plugin {
  let isDev = false;
  const projectRoot = process.cwd();
  // ARCRX_DATA_DIR isolates a workspace (e2e runs use a fresh one per run).
  const dataDir = resolvePath(projectRoot, process.env.ARCRX_DATA_DIR || options.dataDir || '.informer-local/pgdata');

  const mock = {
    report: { id: 'dev-local', name: 'Local Development', ...(options.mock?.report || {}) },
    theme: options.mock?.theme || 'light',
    roles: options.mock?.roles || [],
    user: { username: 'dev', displayName: 'Local Developer', ...(options.mock?.user || {}) },
    platform: { version: 'dev', originMode: true, mirror: 'arcrx-local', capabilities: CAPABILITIES },
  };

  // One process per data directory: two PGlite instances writing the same files
  // corrupt the workspace (e.g. a second `npm run dev` that drifted to another port).
  function claimDataDir() {
    const lock = join(dataDir, '.arcrx-owner');
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, 'utf8').trim());
      let alive = false;
      if (pid && pid !== process.pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
      if (alive) throw new Error(`workspace ${dataDir} is already open in another process (pid ${pid}). Stop that dev/preview server first, or set ARCRX_DATA_DIR to use a separate workspace.`);
    }
    writeFileSync(lock, String(process.pid));
  }

  // Cached on globalThis so a Vite config restart (which re-evaluates this
  // plugin in the same process) reuses the open PGlite instance instead of
  // opening the data directory twice, which aborts the WASM runtime.
  const g = globalThis as typeof globalThis & { __arcrxDb?: Map<string, Promise<PGlite>> };
  g.__arcrxDb ||= new Map();
  const getDb = () => {
    let p = g.__arcrxDb!.get(dataDir);
    if (!p) { p = openWorkspace(); g.__arcrxDb!.set(dataDir, p); }
    return p;
  };

  async function openWorkspace(): Promise<PGlite> {
    mkdirSync(dataDir, { recursive: true });
    claimDataDir();
    const db = await PGlite.create(dataDir);
    await db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, executed_at TIMESTAMPTZ DEFAULT NOW());');
    const applied = new Set((await db.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name));
    const migrationsDir = resolvePath(projectRoot, 'migrations');
    if (existsSync(migrationsDir)) {
      const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = await readFile(join(migrationsDir, file), 'utf8');
        try {
          await db.exec(`BEGIN; ${sql}; INSERT INTO _migrations (name) VALUES ('${file.replace(/'/g, "''")}'); COMMIT;`);
          console.log(`[arcrx-local] applied migration ${file}`);
        } catch (err) {
          await db.exec('ROLLBACK;').catch(() => {});
          console.error(`[arcrx-local] migration ${file} failed: ${(err as Error).message}`);
          throw err;
        }
      }
    }
    return db;
  }

  const query: Query = async (sql, params = []) => (await (await getDb()).query<Row>(sql, params as unknown[])).rows;

  async function transaction<T>(fn: (bag: { query: Query }) => Promise<T>): Promise<T> {
    const db = await getDb();
    return db.transaction(async (tx) => fn({ query: async (sql, params = []) => (await tx.query<Row>(sql, params as unknown[])).rows }));
  }

  /** Sandbox fetch(): only the AI routes exist offline. */
  async function apiFetch(path: string, opts: { method?: string; body?: unknown } = {}) {
    const clean = String(path).replace(/^\/?api\//, '').replace(/^\//, '');
    if (clean === 'ai-budget') return { status: 200, body: { configured: aiAvailable(), mirror: 'arcrx-local' }, contentType: 'application/json' };
    if (clean === 'chat-models') return { status: 200, body: { total: aiAvailable() ? 1 : 0, _embedded: { 'inf:model': aiAvailable() ? [{ slug: 'go_everyday', name: 'Anthropic (local mirror)' }] : [] } }, contentType: 'application/json' };
    const m = clean.match(/^models\/([^/]+)\/(_object|_completion|_chat)$/);
    if (!m) return { status: 404, body: { message: `offline mirror: /api/${clean} is not available without INFORMER_URL` }, contentType: 'application/json' };
    if (!aiAvailable()) return { status: 503, body: { message: 'offline mirror: set ANTHROPIC_API_KEY to enable AI; using rule-based fallback' }, contentType: 'application/json' };
    const body = (opts.body || {}) as Record<string, unknown>;
    try {
      if (m[2] === '_object') return { status: 200, body: await objectCompletion(body.schema as Record<string, unknown>, (body.messages || []) as never), contentType: 'application/json' };
      if (m[2] === '_completion') return { status: 200, body: await textCompletion(String(body.prompt || '')), contentType: 'text/plain' };
      return { status: 400, body: { message: 'use /api/_agent/:name/_trigger for agent loops in the mirror' }, contentType: 'application/json' };
    } catch (err) {
      return { status: 502, body: { message: (err as Error).message }, contentType: 'application/json' };
    }
  }

  const emitted: Array<{ event: string; payload: unknown; at: string }> = [];
  const emit = async (event: string, payload: unknown) => {
    emitted.push({ event, payload, at: new Date().toISOString() });
    if (emitted.length > 200) emitted.shift();
    console.log(`[app-event] ${event}`, JSON.stringify(payload).slice(0, 200));
  };
  const notify = async (username: string, message: string) => {
    if (!username || !message) throw new Error('notify(username, message) requires both arguments');
    console.log(`[notify → ${username}] ${message}`);
  };
  const email = async (to: string, message: unknown) => {
    if (!to || !message) throw new Error('email(to, message) requires both arguments');
    console.log(`[email → ${to}]`, JSON.stringify(message).slice(0, 200));
  };

  const baseBag = () => ({
    query,
    transaction,
    fetch: apiFetch,
    emit,
    broadcast: (_c: string, _e: string, _p: unknown) => {},
    notify,
    email,
    context: {},
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('ARCRX_'))),
    platform: mock.platform,
    markdown: (t: string) => t,
    log: buildLog('[app-log]'),
    crypto: { randomUUID: async () => crypto.randomUUID() },
  });

  function loadManifest(): Record<string, unknown> {
    try { return (loadYaml(readFileSync(resolvePath(projectRoot, 'informer.yaml'), 'utf8')) as Record<string, unknown>) || {}; } catch { return {}; }
  }

  async function loadTools(_server: unknown, names: string[]): Promise<LocalTool[]> {
    const files = await walkJsFiles(resolvePath(projectRoot, 'tools'), 'tools');
    const tools: LocalTool[] = [];
    for (const name of names) {
      const file = files.find((f) => f.relPath.replace(/^tools\//, '').replace(/\.js$/, '').replace(/\//g, '_') === name);
      if (!file) { console.warn(`[arcrx-local] tool "${name}" not found in tools/`); continue; }
      const mod = await loadModule(file.absPath);
      if (typeof mod.handler !== 'function') continue;
      tools.push({
        name,
        description: mod.description || `Tool: ${name}`,
        inputSchema: mod.schema || { type: 'object', properties: {} },
        handler: (args) => mod.handler({ args, run: { agentName: currentAgent, runId: currentRunId, trigger: currentTrigger }, ...baseBag() }),
      });
    }
    return tools;
  }
  // Dev: Vite's SSR loader (HMR). Preview: plain dynamic import, re-imported when the file changes.
  let loadModule: (file: string) => Promise<Record<string, any>> = async (file) => import(`${pathToFileURL(file).href}?t=${statSync(file).mtimeMs}`); // eslint-disable-line @typescript-eslint/no-explicit-any

  let currentAgent = '';
  let currentRunId = '';
  let currentTrigger: unknown = null;

  async function serverRoutes(server: unknown, req: IncomingMessage, res: ServerResponse, next: () => void) {
    const parsed = parseUrl(req.url || '/', true);
    const routePath = parsed.pathname || '/';
    const files = await walkJsFiles(resolvePath(projectRoot, 'server'), 'server');
    const table = files.map((f) => ({ path: filePathToRoute(f.relPath), filePath: f.absPath }));
    const match = matchRoute(table, routePath);
    if (!match) return next();
    const method = (req.method || 'GET').toUpperCase();
    if (!VALID_METHODS.includes(method)) return send(res, 405, { error: 'Method not allowed' });
    try {
      const mod = await loadModule(match.route.filePath);
      const handler = mod[method];
      if (typeof handler !== 'function') return send(res, 404, { error: 'Method not found' });
      // Demo-only role override: the UI switches between patient/clinician views.
      // Applied before the config.roles gate so the dev server refuses what Informer would.
      const asRole = typeof parsed.query.__role === 'string' ? parsed.query.__role : null;
      const roles = asRole ? [asRole] : mock.roles;
      const required = mod.config?.roles as string[] | undefined;
      if (Array.isArray(required) && required.length && !required.some((r) => roles.includes(r))) return send(res, 403, { error: 'Forbidden for your role' });
      const body = await readBody(req);
      const request = {
        method,
        path: routePath,
        params: match.params,
        query: parsed.query,
        body,
        headers: {},
        roles: asRole ? [asRole] : roles,
        user: { ...mock.user, email: null, timezone: null },
        app: { id: mock.report.id },
      };
      let responded = false;
      const respond = async (early: unknown) => {
        if (responded) return;
        responded = true;
        if (early && typeof early === 'object' && typeof (early as Row).status === 'number') {
          const d = early as { status: number; body?: unknown; headers?: Record<string, string> };
          return send(res, d.status, d.body, d.headers);
        }
        send(res, 200, early);
      };
      const result = await handler({ ...baseBag(), request, respond });
      if (responded) return;
      if (result === undefined || result === null) return send(res, 204, null);
      if (result && typeof result === 'object' && typeof (result as Row).status === 'number') {
        const d = result as { status: number; body?: unknown; headers?: Record<string, string> };
        return send(res, d.status, d.body, d.headers);
      }
      send(res, 200, result);
    } catch (err) {
      (server as ViteDevServer | undefined)?.ssrFixStacktrace?.(err as Error);
      console.error('[arcrx-local server-routes]', err);
      send(res, 500, { error: (err as Error).message });
    }
  }

  async function agentRoutes(server: unknown, req: IncomingMessage, res: ServerResponse, next: () => void) {
    const parsed = parseUrl(req.url || '/', true);
    const routePath = parsed.pathname || '/';
    const manifest = loadManifest();
    const agents = (manifest.agents || {}) as Record<string, Record<string, unknown>>;
    if (req.method === 'GET' && (routePath === '/' || routePath === '')) {
      return send(res, 200, Object.entries(agents).map(([name, def]) => ({
        name, description: def.description || null, model: def.model || 'go_everyday', tools: def.tools || [], on: def.on || [], cron: def.cron || null,
        mode: aiAvailable() ? 'llm' : 'fallback',
      })));
    }
    const trigger = routePath.match(/^\/([^/]+)\/_trigger$/);
    if (req.method === 'POST' && trigger) {
      const name = decodeURIComponent(trigger[1]);
      const def = agents[name];
      if (!def) return send(res, 404, { error: `Agent "${name}" not found in informer.yaml` });
      const body = ((await readBody(req)) || {}) as Record<string, unknown>;
      const event = String(body.event || '_manual');
      const payload = body.payload || {};
      currentAgent = name;
      currentRunId = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      currentTrigger = { event, payload };
      const tools = await loadTools(server, (def.tools as string[]) || []);
      const started = Date.now();
      try {
        let steps: AgentStep[] = [];
        let text = '';
        let tokens = 0;
        let mode: 'llm' | 'fallback' = 'fallback';
        if (aiAvailable()) {
          mode = 'llm';
          console.log(`[arcrx-local] agent ${name}: LLM loop with ${tools.map((t) => t.name).join(', ')}`);
          const out = await runAgentLoop({ instructions: String(def.instructions || ''), tools, event, payload, log: (l) => console.log(`[agent ${name}] ${l}`) });
          steps = out.steps; text = out.text; tokens = out.tokens;
        } else {
          const planPath = resolvePath(projectRoot, 'agents', `${name}.yaml`);
          if (!existsSync(planPath)) return send(res, 503, { error: `No LLM available and agents/${name}.yaml has no fallback plan` });
          const plan = (loadYaml(readFileSync(planPath, 'utf8')) as { fallback?: FallbackPlan }).fallback;
          if (!plan) return send(res, 503, { error: `agents/${name}.yaml has no fallback plan` });
          console.log(`[arcrx-local] agent ${name}: deterministic fallback plan (set ANTHROPIC_API_KEY for the LLM loop)`);
          const out = await runFallbackPlan({ plan, payload, tools: Object.fromEntries(tools.map((t) => [t.name, t.handler])), log: (l) => console.log(`[agent ${name}] ${l}`) });
          steps = out.steps; text = out.text;
        }
        // The tools write their own audit rows (lib/audit.js); the console reads those.
        const run = { id: currentRunId, agent: name, trigger: event, status: 'completed', tokens, mode, durationMs: Date.now() - started, steps, summary: text };
        return send(res, 200, run);
      } catch (err) {
        console.error('[arcrx-local agent]', err);
        return send(res, 500, { error: (err as Error).message });
      }
    }
    next();
  }

  async function modelRoutes(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const parsed = parseUrl(req.url || '/', true);
    const m = (parsed.pathname || '').match(/^\/([^/]+)\/(_object|_completion|_chat)$/);
    if (!m || req.method !== 'POST') return next();
    const body = ((await readBody(req)) || {}) as Record<string, unknown>;
    const out = await apiFetch(`models/${m[1]}/${m[2]}`, { method: 'POST', body });
    if (m[2] === '_completion' && out.status === 200) return sendSse(res, [{ type: 'text-delta', delta: out.body }, { type: 'finish-step', usage: {} }]);
    send(res, out.status, out.body);
  }

  return {
    name: 'arcrx-local-informer',
    config(_, { command }) {
      isDev = command === 'serve';
      return { base: './' };
    },
    async configureServer(server) {
      if (!isDev) return;
      loadModule = (file) => server.ssrLoadModule(file);
      await mount(server, server.middlewares);
    },
    // `vite preview` serves the production bundle (dist/) with this same API but
    // reports a non-dev platform: no injected context, no __role, no dev agent
    // triggers, in-process triage — the code paths the deployed app runs.
    async configurePreviewServer(server) {
      mock.platform.version = 'preview';
      await mount(undefined, server.middlewares);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!isDev) return html;
        const script = `<script>window.__INFORMER__ = ${JSON.stringify(mock)};</script>`;
        const i = html.indexOf('<head>');
        return i === -1 ? script + html : html.slice(0, i + 6) + '\n' + script + html.slice(i + 6);
      },
    },
  };

  async function mount(server: ViteDevServer | undefined, middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => unknown }) {
      try {
        await getDb();
        const [{ n }] = await query('SELECT COUNT(*)::int AS n FROM patients');
        console.log(`[arcrx-local] workspace ready at ${dataDir} (${n} patients) — AI: ${aiAvailable() ? 'Anthropic' : 'rule-based fallback'}`);
      } catch (err) {
        console.error('[arcrx-local] workspace failed to open:', (err as Error).message);
      }
      middlewares.use('/api/_agent', (req, res, next) => void agentRoutes(server, req, res, next));
      middlewares.use('/api/models', (req, res, next) => void modelRoutes(req, res, next));
      middlewares.use('/api/_events', (_req, res) => send(res, 200, emitted.slice(-50).reverse()));
      // App routes answer at bare /api/<path>, as on Informer (2026.1.2+ origin mode);
      // /api/_server/<path> stays as the legacy dev spelling.
      middlewares.use('/api/_server', (req, res, next) => void serverRoutes(server, req, res, next));
      middlewares.use('/api', (req, res, next) => void serverRoutes(server, req, res, next));
  }
}
