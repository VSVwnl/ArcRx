import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import informer from '@entrinsik/vite-plugin-informer';
import { localInformer } from './dev/local-informer.ts';
import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';

// `virtual:arcrx-manifest` — informer.yaml parsed at build time, so the agent
// console lists exactly the agents that were deployed without shipping a YAML
// parser to the browser.
function manifestModule() {
  const id = 'virtual:arcrx-manifest';
  const resolved = '\0' + id;
  return {
    name: 'arcrx-manifest',
    resolveId(source: string) { return source === id ? resolved : null; },
    load(target: string) {
      if (target !== resolved) return null;
      const manifest = loadYaml(readFileSync(new URL('./informer.yaml', import.meta.url), 'utf8')) || {};
      return `export default ${JSON.stringify(manifest)};`;
    },
    handleHotUpdate(ctx: { file: string; server: { moduleGraph: { getModuleById(id: string): unknown }; reloadModule(mod: never): void } }) {
      if (!ctx.file.endsWith('informer.yaml')) return;
      const mod = ctx.server.moduleGraph.getModuleById(resolved);
      if (mod) ctx.server.reloadModule(mod as never);
    },
  };
}

// ArcRx runs in two modes with one codebase:
//   1. INFORMER_URL set   -> the official Informer dev plugin proxies /api,
//      runs server/ handlers against the dev workspace and agents on Informer AI.
//   2. INFORMER_URL unset -> the local mirror (dev/local-informer.ts) mounts the
//      same /api/_server, /api/_agent and /api/models surfaces on PGlite so the
//      whole app, agents included, runs offline on a laptop.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const offline = !env.INFORMER_URL;
  return {
    plugins: [
      react(),
      tailwindcss(),
      manifestModule(),
      offline
        ? localInformer({ mock: { theme: 'dark', roles: ['clinician', 'patient'] } })
        : informer({ mock: { theme: 'dark', roles: ['clinician', 'patient'] } }),
    ],
    // Fixed port: a second `npm run dev` fails loudly instead of starting on 5174 against the same workspace.
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  };
});
