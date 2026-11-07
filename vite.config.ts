import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import informer from '@entrinsik/vite-plugin-informer';
import { localInformer } from './dev/local-informer';

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
      informer({ mock: { theme: 'dark', roles: ['clinician', 'patient'] } }),
      ...(offline ? [localInformer({ mock: { theme: 'dark', roles: ['clinician', 'patient'] } })] : []),
    ],
    server: { port: 5173, strictPort: false },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  };
});
