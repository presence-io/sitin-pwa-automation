// Console / error capture for remote test observation.
// installLogCapture() hooks console + window errors into a ring buffer (always on,
// cheap). startLogStream()/stopLogStream() push that buffer to Firebase only while
// a dashboard has screen-sync enabled for this device.

import { fbPut, fbDelete } from '../shared/firebase';
import { getDeviceId } from './remote';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: number;
}

const MAX_ENTRIES = 400;
const MAX_MSG_LEN = 800;

const ring: LogEntry[] = [];
let seq = 0;
let dirty = false;
let installed = false;

let flushTimer: ReturnType<typeof setInterval> | null = null;

// Format console args into a single string. Handles the `%c` CSS directive used by
// helpers.log/warn by stripping the token and dropping its paired style argument.
function fmt(args: unknown[]): string {
  if (args.length === 0) return '';
  let out: string[] = [];
  let i = 0;
  const first = args[0];
  if (typeof first === 'string' && first.includes('%c')) {
    // Count %c occurrences; each consumes one following style arg.
    const styleCount = (first.match(/%c/g) || []).length;
    const text = first.replace(/%c/g, '');
    out.push(text);
    i = 1 + styleCount; // skip the style strings
  }
  for (; i < args.length; i++) {
    out.push(stringify(args[i]));
  }
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MSG_LEN);
}

function stringify(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'string') return v as string;
  if (t === 'number' || t === 'boolean') return String(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v, replacer());
  } catch {
    return Object.prototype.toString.call(v);
  }
}

// Guard against circular references when serializing console args.
function replacer() {
  const seen = new WeakSet<object>();
  return (_k: string, val: unknown) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  };
}

function push(level: LogLevel, args: unknown[]): void {
  const msg = fmt(args);
  if (!msg) return;
  ring.push({ level, msg, ts: Date.now() });
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
  seq++;
  dirty = true;
}

export function installLogCapture(): void {
  if (installed) return;
  installed = true;

  const levels: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
  for (const level of levels) {
    const orig = (console as any)[level] as ((...a: unknown[]) => void) | undefined;
    if (typeof orig !== 'function') continue;
    (console as any)[level] = (...args: unknown[]) => {
      try { push(level, args); } catch {}
      orig.apply(console, args);
    };
  }

  window.addEventListener('error', (e: ErrorEvent) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
    push('error', [`Uncaught ${e.message}${where}`]);
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    push('error', ['Unhandled rejection:', e.reason]);
  });
}

async function flush(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  const deviceId = getDeviceId();
  await fbPut(`logs/${deviceId}`, {
    entries: ring.slice(-MAX_ENTRIES),
    seq,
    updatedAt: Date.now(),
  });
}

export function startLogStream(fps = 1): void {
  if (flushTimer) return;
  dirty = true; // push current backlog immediately
  const interval = Math.max(500, Math.round(1000 / fps));
  flushTimer = setInterval(flush, interval);
  flush();
}

export function stopLogStream(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  const deviceId = getDeviceId();
  fbDelete(`logs/${deviceId}`);
}
