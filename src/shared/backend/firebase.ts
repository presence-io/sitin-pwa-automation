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
      // RTDB's SSE already carries the data (put/patch events each include the
      // changed value at a relative path). We keep a local mirror of the watched
      // subtree and hand callers the current value — they must NOT re-read.
      // Re-fetching on every event (esp. large screen frames) floods the ~6
      // per-host connections behind the long-lived SSE and stalls into a pile of
      // pending requests. EventSource fires an initial 'put' with the full
      // snapshot on connect, so the first emit already carries real data.
      let es: EventSource | null = null;
      let mirror: any = null;
      const setAt = (rel: string, val: any) => {
        const segs = (rel || '').split('/').filter(Boolean);
        if (!segs.length) { mirror = val; return; }
        if (mirror === null || typeof mirror !== 'object') mirror = {};
        let node = mirror;
        for (let i = 0; i < segs.length - 1; i++) {
          const k = segs[i];
          if (node[k] === null || typeof node[k] !== 'object') node[k] = {};
          node = node[k];
        }
        const last = segs[segs.length - 1];
        if (val === null || val === undefined) delete node[last]; else node[last] = val;
      };
      const emit = () => {
        const snap = (mirror !== null && typeof mirror === 'object')
          ? (Array.isArray(mirror) ? mirror.slice() : { ...mirror })
          : mirror;
        try { onEvent(snap); } catch {}
      };
      try {
        es = new EventSource(url(path));
        es.addEventListener('put', (ev: any) => {
          try { const m = JSON.parse(ev.data); setAt(m.path, m.data); } catch {}
          emit();
        });
        es.addEventListener('patch', (ev: any) => {
          try {
            const m = JSON.parse(ev.data);
            const d = m.data;
            if (d && typeof d === 'object')
              for (const k in d) setAt(m.path === '/' ? k : m.path + '/' + k, d[k]);
          } catch {}
          emit();
        });
      } catch (e) { console.warn('[fb] firebase listen', path, e); }
      return { close() { try { es && es.close(); } catch {} } };
    },
    ownsUrl(u: string): boolean { return !!host && u.includes(host); },
  };
}
