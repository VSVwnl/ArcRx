// The Informer app context injected into the page by the platform (or by the
// dev plugin / local mirror): window.__INFORMER__.
export interface InformerContext {
  report: { id: string; name: string };
  theme: 'light' | 'dark';
  roles: string[];
  user: { username: string; displayName: string };
  platform?: { version?: string; originMode?: boolean; mirror?: string; capabilities?: Record<string, boolean> };
}

declare global {
  interface Window {
    __INFORMER__?: InformerContext;
  }
}

// Public pages on Informer may render with no injected context (anonymous
// visitor); the session probe (/api/me) is the source of truth for who is
// signed in and with which roles. This fallback is deliberately empty.
export function informer(): InformerContext {
  return (
    window.__INFORMER__ || {
      report: { id: 'public', name: 'ArcRx' },
      theme: 'dark',
      roles: [],
      user: { username: '', displayName: '' },
      platform: { version: 'public', capabilities: {} },
    }
  );
}

export const isDevPlatform = () => informer().platform?.version === 'dev';
export const isLocalMirror = () => informer().platform?.mirror === 'arcrx-local';
export const hasRole = (r: string) => informer().roles.includes(r);
