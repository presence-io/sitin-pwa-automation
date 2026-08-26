// Firebase Realtime Database adapter (REST + SSE).
//
// RTDB's native tree shape already matches every fb* call site (that's what they
// were written for), so paths map 1:1 with no reshaping. Realtime uses the REST
// streaming endpoint over EventSource. Assumes open rules (this whole system is
// unauthenticated); if your rules require auth, front it with the relay adapter.

import type { Backend, FbSub } from './types';

export function makeFirebaseBackend(cfg: { databaseURL?: string }): Backend {
  const base = (cfg.databaseURL || '').replace(/\/+$/, '');
  if (!base) {
    console.error('[fb] firebase backend needs data-backend-config {"databaseURL":"https://xxx.firebaseio.com"}');
  }
  const host = (() => { try { return new URL(base).host; } catch { return base; } })();
  const url = (path: string) => `${base}/${path}.json`;

  return {
    async get<T>(path: string): Promise<T | null> {
      const resp = await fetch(url(path));
      if (!resp.ok) throw new Error(`firebase get ${resp.status}`);
      const v = await resp.json();
      return (v === null || v === undefined) ? null : (v as T);
    },
    async put(path: string, data: any): Promise<void> {
      const resp = await fetch(url(path), { method: 'PUT', body: JSON.stringify(data) });
      if (!resp.ok) throw new Error(`firebase put ${resp.status}`);
    },
    async patch(path: string, data: any): Promise<void> {
      const resp = await fetch(url(path), { method: 'PATCH', body: JSON.stringify(data) });
      if (!resp.ok) throw new Error(`firebase patch ${resp.status}`);
    },
    async delete(path: string): Promise<void> {
      const resp = await fetch(url(path), { method: 'DELETE' });
      if (!resp.ok) throw new Error(`firebase delete ${resp.status}`);
    },
    listen(path: string, onEvent: (data: any) => void): FbSub {
      // Callers ignore the payload and re-read via fbGet, so any put/patch just
      // pings onEvent(). EventSource fires an initial 'put' with the current
      // value on connect — that first ping primes the reader.
      let es: EventSource | null = null;
      try {
        es = new EventSource(url(path));
        const ping = () => { try { onEvent(undefined); } catch {} };
        es.addEventListener('put', ping);
        es.addEventListener('patch', ping);
      } catch (e) { console.warn('[fb] firebase listen', path, e); }
      return { close() { try { es && es.close(); } catch {} } };
    },
    ownsUrl(u: string): boolean { return !!host && u.includes(host); },
  };
}
