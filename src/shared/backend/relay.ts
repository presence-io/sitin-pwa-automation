// Self-hosted relay adapter (REST + SSE) — the no-vendor / China-friendly path.
//
// Talks to the tiny relay server in ../../../relay-server (a path-tree store with
// SSE subscribe, open CORS). Same tree semantics as Firebase RTDB, so it's a drop
// -in with none of Firebase's GFW/whitelist problems: you run it on any box you
// control and point data-backend-config {"url":"https://relay.example.com"} at it.

import type { Backend, FbSub } from './types';

export function makeRelayBackend(cfg: { url?: string }): Backend {
  const base = (cfg.url || '').replace(/\/+$/, '');
  if (!base) {
    console.error('[fb] relay backend needs data-backend-config {"url":"https://your-relay"}');
  }
  const host = (() => { try { return new URL(base).host; } catch { return base; } })();
  const enc = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const dataUrl = (path: string) => `${base}/data/${enc(path)}`;

  return {
    async get<T>(path: string): Promise<T | null> {
      const resp = await fetch(dataUrl(path));
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`relay get ${resp.status}`);
      const v = await resp.json();
      return (v === null || v === undefined) ? null : (v as T);
    },
    async put(path: string, data: any): Promise<void> {
      const resp = await fetch(dataUrl(path), { method: 'PUT', body: JSON.stringify(data) });
      if (!resp.ok) throw new Error(`relay put ${resp.status}`);
    },
    async patch(path: string, data: any): Promise<void> {
      const resp = await fetch(dataUrl(path), { method: 'PATCH', body: JSON.stringify(data) });
      if (!resp.ok) throw new Error(`relay patch ${resp.status}`);
    },
    async delete(path: string): Promise<void> {
      const resp = await fetch(dataUrl(path), { method: 'DELETE' });
      if (!resp.ok && resp.status !== 404) throw new Error(`relay delete ${resp.status}`);
    },
    listen(path: string, onEvent: (data: any) => void): FbSub {
      // Server pushes an SSE message whenever anything under `path` changes;
      // callers re-read via fbGet, so we just ping onEvent().
      let es: EventSource | null = null;
      try {
        es = new EventSource(`${base}/watch/${enc(path)}`);
        es.onmessage = () => { try { onEvent(undefined); } catch {} };
      } catch (e) { console.warn('[fb] relay listen', path, e); }
      return { close() { try { es && es.close(); } catch {} } };
    },
    ownsUrl(u: string): boolean { return !!host && u.includes(host); },
  };
}
