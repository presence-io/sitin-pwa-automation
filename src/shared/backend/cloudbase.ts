// Tencent CloudBase 文档型数据库 adapter — a managed China-hosted option.
//
// Note: CloudBase's browser SDK routes DB traffic to the region subdomain, which
// is gated by the env's 「Web 安全来源」 whitelist. You MUST add your injection
// origin to that whitelist in the CloudBase console, or every /web request is
// CORS-blocked. (The relay adapter avoids this entirely.) Realtime uses .watch().
//
// RTDB tree path -> collection/doc mapping:
//   1-level  col/{id}     -> collection `col`, doc _id = id
//   2-level  col/{a}/{b}  -> collection `col`, doc _id = `a__b`, fields _pk=a _lk=b
// (2-level collections: results, rtc, suites, recordings.) Parent reads/listens at
// col/{a} query by _pk and reshape to { _lk: value }; whole-collection reads key by _id.

import type { Backend, FbSub } from './types';

// Self-hosted on the Pages origin (same as rrweb) and inline-injected so strict
// PWA CSPs that block external <script src> still allow it. Exposes window.cloudbase.
const SDK_URL = 'https://presence-io.github.io/sitin-pwa-automation/cloudbase.full.js';
const TWO_LEVEL = new Set(['results', 'rtc', 'suites', 'recordings', 'screens']);

type CB = any;

function clean(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc;
  const out: any = {};
  for (const k in doc) if (k[0] !== '_') out[k] = doc[k];
  return out;
}
function docsOf(r: any): any[] { return (r && (r.data || r.docs)) || []; }

export function makeCloudbaseBackend(cfg: { env?: string; region?: string }): Backend {
  const env = cfg.env || '';
  const region = cfg.region || 'ap-shanghai';
  if (!env) console.error('[fb] cloudbase backend needs data-backend-config {"env":"...","region":"..."}');

  let sdkPromise: Promise<CB> | null = null;
  function loadSdk(): Promise<CB> {
    const existing = (window as any).cloudbase as CB | undefined;
    if (existing) return Promise.resolve(existing);
    if (sdkPromise) return sdkPromise;
    sdkPromise = (async () => {
      let code: string;
      try {
        const resp = await fetch(SDK_URL);
        if (!resp.ok) throw new Error(`cloudbase fetch ${resp.status}`);
        code = await resp.text();
      } catch (e) { sdkPromise = null; throw new Error('cloudbase load failed: ' + (e as Error).message); }
      const s = document.createElement('script');
      s.textContent = code; // inline — allowed wherever the inline-injected agent runs
      document.head.appendChild(s);
      const cb = (window as any).cloudbase as CB | undefined;
      if (!cb) { sdkPromise = null; throw new Error('cloudbase global missing after load'); }
      return cb;
    })();
    return sdkPromise;
  }

  let dbPromise: Promise<any> | null = null;
  function getDb(): Promise<any> {
    if (dbPromise) return dbPromise;
    dbPromise = (async () => {
      const cb = await loadSdk();
      const app = cb.init({ env, region });
      const auth = (typeof app.auth === 'function') ? app.auth({ persistence: 'local' }) : app.auth;
      try {
        if (auth && typeof auth.signInAnonymously === 'function') await auth.signInAnonymously();
        else if (auth && typeof auth.anonymousAuthProvider === 'function') await auth.anonymousAuthProvider().signIn();
      } catch (e) { console.warn('[fb] cloudbase anon sign-in', e); }
      const db = app.database();
      try { await db.collection('devices').limit(1).get(); } catch {}
      return db;
    })().catch((e) => { dbPromise = null; throw e; });
    return dbPromise;
  }

  interface Ref { col: string; segs: string[]; two: boolean; coll: any; }
  function ref(db: any, path: string): Ref {
    const segs = path.split('/').filter(Boolean);
    const col = segs[0];
    return { col, segs, two: TWO_LEVEL.has(col), coll: db.collection(col) };
  }
  function docId(r: Ref): string {
    return (r.segs.length === 3 && r.two) ? `${r.segs[1]}__${r.segs[2]}` : r.segs[1];
  }

  return {
    async get<T>(path: string): Promise<T | null> {
      const db = await getDb();
      const r = ref(db, path);
      if (r.segs.length === 1) {
        const docs = docsOf(await r.coll.get());
        if (!docs.length) return null;
        const map: any = {}; for (const d of docs) map[d._id] = clean(d); return map;
      }
      if (r.segs.length === 2 && r.two) {
        const docs = docsOf(await r.coll.where({ _pk: r.segs[1] }).get());
        if (!docs.length) return null;
        const map: any = {}; for (const d of docs) map[d._lk] = clean(d); return map;
      }
      const docs = docsOf(await r.coll.doc(docId(r)).get());
      return docs.length ? clean(docs[0]) : null;
    },
    async put(path: string, data: any): Promise<void> {
      const db = await getDb();
      const r = ref(db, path);
      const extra = (r.segs.length === 3 && r.two) ? { _pk: r.segs[1], _lk: r.segs[2] } : {};
      await r.coll.doc(docId(r)).set({ ...data, ...extra });
    },
    async patch(path: string, data: any): Promise<void> {
      const db = await getDb();
      const r = ref(db, path);
      const id = docId(r);
      const extra = (r.segs.length === 3 && r.two) ? { _pk: r.segs[1], _lk: r.segs[2] } : {};
      const res = await r.coll.doc(id).update(data).catch(() => null);
      if (!res || res.updated === 0) await r.coll.doc(id).set({ ...data, ...extra });
    },
    async delete(path: string): Promise<void> {
      const db = await getDb();
      const r = ref(db, path);
      if (r.segs.length === 2 && r.two) { await r.coll.where({ _pk: r.segs[1] }).remove(); return; }
      await r.coll.doc(docId(r)).remove();
    },
    listen(path: string, onEvent: (data: any) => void): FbSub {
      let watcher: any = null;
      let closed = false;
      (async () => {
        try {
          const db = await getDb();
          const r = ref(db, path);
          let query: any;
          if (r.segs.length === 1) query = r.coll;
          else if (r.segs.length === 2 && r.two) query = r.coll.where({ _pk: r.segs[1] });
          else query = r.coll.where({ _id: docId(r) });
          if (closed) return;
          watcher = query.watch({
            onChange: () => { try { onEvent(undefined); } catch {} },
            onError: (e: any) => console.warn('[fb] cloudbase watch', path, e),
          });
        } catch (e) { console.warn('[fb] cloudbase listen', path, e); }
      })();
      return { close() { closed = true; try { watcher && watcher.close(); } catch {} } };
    },
    ownsUrl(u: string): boolean { return u.includes('tcb-api.tencentcloudapi.com'); },
  };
}
