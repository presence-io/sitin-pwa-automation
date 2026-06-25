// Network capture for remote test observation.
// installNetworkCapture() patches fetch + XMLHttpRequest into a ring buffer
// (always on, cheap, metadata only). startNetworkStream()/stopNetworkStream()
// push that buffer to Firebase only while a dashboard has sync enabled for this
// device. Mirrors logsync.ts / storagesync.ts.

import { fbPut, fbDelete, DB_URL } from '../shared/firebase';
import { getDeviceId } from './remote';

export interface NetEntry {
  id: number;
  type: 'fetch' | 'xhr';
  method: string;
  url: string;
  status: number;   // 0 until settled / on network error
  ok: boolean;
  ts: number;       // request start
  durMs: number;    // start → settle
  size: number;     // response content-length if known, else 0
  err: string;      // network/abort error message, else ''
}

const MAX_ENTRIES = 200;
const MAX_URL_LEN = 300;

const ring: NetEntry[] = [];
let seq = 0;
let id = 0;
let dirty = false;
let installed = false;

let flushTimer: ReturnType<typeof setInterval> | null = null;

// Skip our own Firebase traffic — otherwise each flush (a fetch) would record
// itself and self-feed forever.
function isOwnTraffic(url: string): boolean {
  return url.startsWith(DB_URL);
}

function clip(url: string): string {
  return url.length > MAX_URL_LEN ? url.slice(0, MAX_URL_LEN) + '…' : url;
}

function record(e: NetEntry): void {
  ring.push(e);
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
  seq++;
  dirty = true;
}

function sizeFromHeaders(get: (name: string) => string | null): number {
  try {
    const len = get('content-length');
    const n = len ? parseInt(len, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function installNetworkCapture(): void {
  if (installed) return;
  installed = true;

  // ── fetch ──
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      let url = '';
      let method = 'GET';
      try {
        const input = args[0];
        url = typeof input === 'string' ? input
          : input instanceof URL ? input.href
          : (input as Request)?.url || '';
        method = (args[1]?.method || (input as Request)?.method || 'GET').toUpperCase();
      } catch {}

      const p = origFetch.apply(this, args as any) as Promise<Response>;
      if (isOwnTraffic(url)) return p;

      const start = Date.now();
      const mine = ++id;
      p.then((res) => {
        try {
          record({
            id: mine, type: 'fetch', method, url: clip(url),
            status: res.status, ok: res.ok, ts: start,
            durMs: Date.now() - start,
            size: sizeFromHeaders((h) => res.headers.get(h)),
            err: '',
          });
        } catch {}
      }).catch((e) => {
        try {
          record({
            id: mine, type: 'fetch', method, url: clip(url),
            status: 0, ok: false, ts: start, durMs: Date.now() - start,
            size: 0, err: (e && e.message) ? String(e.message) : 'network error',
          });
        } catch {}
      });
      return p;
    } as typeof window.fetch;
  }

  // ── XMLHttpRequest ──
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (this: any, method: string, url: string, ...rest: any[]) {
      try {
        this.__nw = { method: (method || 'GET').toUpperCase(), url: String(url || '') };
      } catch {}
      return origOpen.apply(this, [method, url, ...rest] as any);
    };

    XHR.prototype.send = function (this: any, ...args: any[]) {
      const meta = this.__nw as { method: string; url: string } | undefined;
      if (!meta || isOwnTraffic(meta.url)) return origSend.apply(this, args as any);

      const start = Date.now();
      const mine = ++id;
      const settle = (err: string) => {
        try {
          record({
            id: mine, type: 'xhr', method: meta.method, url: clip(meta.url),
            status: this.status || 0,
            ok: this.status >= 200 && this.status < 400,
            ts: start, durMs: Date.now() - start,
            size: sizeFromHeaders((h) => {
              try { return this.getResponseHeader(h); } catch { return null; }
            }),
            err,
          });
        } catch {}
      };
      try {
        this.addEventListener('loadend', () => settle(''));
        this.addEventListener('error', () => settle('network error'));
        this.addEventListener('abort', () => settle('aborted'));
        this.addEventListener('timeout', () => settle('timeout'));
      } catch {}
      return origSend.apply(this, args as any);
    };
  }
}

async function flush(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  const deviceId = getDeviceId();
  await fbPut(`network/${deviceId}`, {
    entries: ring.slice(-MAX_ENTRIES),
    seq,
    updatedAt: Date.now(),
  });
}

export function startNetworkStream(fps = 1): void {
  if (flushTimer) return;
  dirty = true; // push current backlog immediately
  const interval = Math.max(500, Math.round(1000 / fps));
  flushTimer = setInterval(flush, interval);
  flush();
}

export function stopNetworkStream(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  const deviceId = getDeviceId();
  fbDelete(`network/${deviceId}`);
}
