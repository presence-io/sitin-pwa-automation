// Network capture for remote test observation.
// installNetworkCapture() patches fetch + XMLHttpRequest into a ring buffer
// (always on, cheap, metadata only). startNetworkStream()/stopNetworkStream()
// push that buffer to Firebase only while a dashboard has sync enabled for this
// device. While a viewer is attached, request/response headers + (bounded)
// bodies are also captured so a row can be expanded; that heavier capture is OFF
// when nobody is watching, keeping the host page cost near zero. Mirrors
// logsync.ts / storagesync.ts. The flush payload is gzip'd (entries as a single
// string) to keep the SSE payload small even with bodies attached.

import { fbPut, fbDelete, isOwnTraffic } from '../shared/firebase';
import { packString } from '../shared/compress';
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
  // Only present while a viewer is attached (captureDetail):
  reqHeaders?: string;
  reqBody?: string;
  resHeaders?: string;
  resBody?: string;
}

const MAX_ENTRIES = 200;
const MAX_URL_LEN = 300;
const MAX_BODY_LEN = 1024;    // per body, chars
const MAX_HEADERS_LEN = 800;  // per header block, chars

const ring: NetEntry[] = [];
let seq = 0;
let id = 0;
let dirty = false;
let installed = false;

// Header/body capture only pays for itself while someone is watching. When no
// viewer is attached we record cheap metadata only, so idle host pages are unaffected.
let captureDetail = false;

let flushTimer: ReturnType<typeof setInterval> | null = null;

// Skip our own backend traffic — otherwise each flush (a fetch/xhr) would record
// itself and self-feed forever. The active backend knows which hosts are its own.

function clip(url: string): string {
  return url.length > MAX_URL_LEN ? url.slice(0, MAX_URL_LEN) + '…' : url;
}

function clipBody(s: string): string {
  return s.length > MAX_BODY_LEN ? s.slice(0, MAX_BODY_LEN) + `…(+${s.length - MAX_BODY_LEN})` : s;
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

// ── detail helpers (only invoked while capturing) ──

// Accepts a Headers instance, a plain object, or an array of [k,v] pairs.
function headersToStr(h: any): string {
  if (!h) return '';
  const lines: string[] = [];
  try {
    if (typeof h.forEach === 'function' && !Array.isArray(h)) {
      h.forEach((v: string, k: string) => lines.push(`${k}: ${v}`)); // Headers
    } else if (Array.isArray(h)) {
      for (const pair of h) if (pair && pair.length >= 2) lines.push(`${pair[0]}: ${pair[1]}`);
    } else if (typeof h === 'object') {
      for (const k of Object.keys(h)) lines.push(`${k}: ${h[k]}`);
    }
  } catch {}
  const out = lines.join('\n');
  return out.length > MAX_HEADERS_LEN ? out.slice(0, MAX_HEADERS_LEN) + '…' : out;
}

function bodyToStr(body: any): string {
  try {
    if (body == null) return '';
    if (typeof body === 'string') return clipBody(body);
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return clipBody(body.toString());
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const parts: string[] = [];
      body.forEach((v: any, k: string) => parts.push(`${k}=${typeof v === 'string' ? v : '[file]'}`));
      return clipBody(parts.join('&'));
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) return `[blob ${body.size}B]`;
    if (body instanceof ArrayBuffer) return `[arraybuffer ${body.byteLength}B]`;
    if (typeof body === 'object') return clipBody(JSON.stringify(body));
    return clipBody(String(body));
  } catch { return ''; }
}

const TEXTUAL = /json|text|xml|javascript|urlencoded|html|graphql/i;

// Read up to MAX_BODY_LEN chars from a *clone* of the response, stopping early so
// large/streaming downloads aren't buffered in full. Non-textual and event-stream
// bodies are summarized rather than read (a never-ending stream would hang .text()).
async function readResBody(res: Response): Promise<string> {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (/event-stream/.test(ct)) return '[event-stream]';
  if (ct && !TEXTUAL.test(ct)) {
    const len = res.headers.get('content-length');
    return `[${ct.split(';')[0]}${len ? ', ' + len + 'B' : ''}]`;
  }
  try {
    const reader = res.body?.getReader();
    if (!reader) return clipBody(await res.text());
    const dec = new TextDecoder();
    let out = '';
    while (out.length < MAX_BODY_LEN) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch {}
    return clipBody(out);
  } catch {
    return '';
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
      let reqHeaders = '';
      let reqBody = '';
      try {
        const input = args[0];
        url = typeof input === 'string' ? input
          : input instanceof URL ? input.href
          : (input as Request)?.url || '';
        method = (args[1]?.method || (input as Request)?.method || 'GET').toUpperCase();
        if (captureDetail) {
          reqHeaders = headersToStr(args[1]?.headers ?? (input as Request)?.headers);
          if (args[1] && 'body' in args[1]) reqBody = bodyToStr(args[1].body);
        }
      } catch {}

      const p = origFetch.apply(this, args as any) as Promise<Response>;
      if (isOwnTraffic(url)) return p;

      const start = Date.now();
      const mine = ++id;
      const detail = captureDetail; // freeze so a mid-flight toggle can't half-capture
      p.then(async (res) => {
        let resHeaders = '';
        let resBody = '';
        if (detail) {
          try { resHeaders = headersToStr(res.headers); } catch {}
          try { resBody = await readResBody(res.clone()); } catch {}
        }
        try {
          record({
            id: mine, type: 'fetch', method, url: clip(url),
            status: res.status, ok: res.ok, ts: start,
            durMs: Date.now() - start,
            size: sizeFromHeaders((h) => res.headers.get(h)),
            err: '',
            ...(detail ? { reqHeaders, reqBody, resHeaders, resBody } : {}),
          });
        } catch {}
      }).catch((e) => {
        try {
          record({
            id: mine, type: 'fetch', method, url: clip(url),
            status: 0, ok: false, ts: start, durMs: Date.now() - start,
            size: 0, err: (e && e.message) ? String(e.message) : 'network error',
            ...(detail ? { reqHeaders, reqBody } : {}),
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
    const origSetHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (this: any, method: string, url: string, ...rest: any[]) {
      try {
        this.__nw = { method: (method || 'GET').toUpperCase(), url: String(url || ''), reqHeaders: [] as string[] };
      } catch {}
      return origOpen.apply(this, [method, url, ...rest] as any);
    };

    XHR.prototype.setRequestHeader = function (this: any, name: string, value: string) {
      try { if (this.__nw && captureDetail) this.__nw.reqHeaders.push(`${name}: ${value}`); } catch {}
      return origSetHeader.apply(this, [name, value] as any);
    };

    XHR.prototype.send = function (this: any, ...args: any[]) {
      const meta = this.__nw as { method: string; url: string; reqHeaders: string[] } | undefined;
      if (!meta || isOwnTraffic(meta.url)) return origSend.apply(this, args as any);

      const start = Date.now();
      const mine = ++id;
      const detail = captureDetail;
      const reqBody = detail ? bodyToStr(args[0]) : '';
      const reqHeaders = detail ? meta.reqHeaders.join('\n').slice(0, MAX_HEADERS_LEN) : '';
      let settled = false; // loadend fires alongside error/abort — record once
      const settle = (err: string) => {
        if (settled) return;
        settled = true;
        let resHeaders = '';
        let resBody = '';
        if (detail) {
          try { resHeaders = (this.getAllResponseHeaders() || '').trim().slice(0, MAX_HEADERS_LEN); } catch {}
          try {
            const rt = this.responseType;
            if (rt === '' || rt === 'text') resBody = clipBody(String(this.responseText || ''));
            else if (rt === 'json') resBody = clipBody(JSON.stringify(this.response));
            else resBody = rt ? `[${rt}]` : '';
          } catch {}
        }
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
            ...(detail ? { reqHeaders, reqBody, resHeaders, resBody } : {}),
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
  const entries = await packString(JSON.stringify(ring.slice(-MAX_ENTRIES)));
  await fbPut(`screens/${deviceId}/network`, {
    entries,
    seq,
    updatedAt: Date.now(),
  });
}

let curFps = 1;

function reschedule(): void {
  if (!flushTimer) return;
  clearInterval(flushTimer);
  flushTimer = setInterval(flush, Math.max(500, Math.round(1000 / curFps)));
}

export function startNetworkStream(fps = 1): void {
  curFps = fps || 1;
  captureDetail = true;
  if (flushTimer) return;
  dirty = true; // push current backlog immediately
  flushTimer = setInterval(flush, Math.max(500, Math.round(1000 / curFps)));
  flush();
}

export function setNetworkFps(fps: number): void {
  const f = fps || 1;
  if (f === curFps) return;
  curFps = f;
  reschedule();
}

export function stopNetworkStream(): void {
  captureDetail = false;
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  const deviceId = getDeviceId();
  fbDelete(`screens/${deviceId}/network`);
}
