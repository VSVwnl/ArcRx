/// <reference types="vite/client" />

// informer.yaml parsed at build time (see vite.config.ts → manifestModule), so
// the browser never runs a YAML parser.
declare module 'virtual:arcrx-manifest' {
  export interface ManifestAgent { description?: string; model?: string; tools?: string[]; on?: string | string[]; cron?: string }
  const manifest: { name?: string; agents?: Record<string, ManifestAgent> };
  export default manifest;
}
