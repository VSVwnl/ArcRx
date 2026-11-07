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

export function informer(): InformerContext {
  return (
    window.__INFORMER__ || {
      report: { id: 'standalone', name: 'ArcRx' },
      theme: 'dark',
      roles: ['clinician', 'patient'],
      user: { username: 'guest', displayName: 'Guest' },
      platform: { version: 'standalone', capabilities: {} },
    }
  );
}

export const isDevPlatform = () => informer().platform?.version === 'dev';
export const isLocalMirror = () => informer().platform?.mirror === 'arcrx-local';
export const hasRole = (r: string) => informer().roles.includes(r);
