// Runtime connection state + on-panel log mirror.
// The injected agent runs on phones where the devtools console is unreachable,
// so connection state and errors must be visible inside the panel itself.

export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'error';

let conn: ConnState = 'connecting';
const connSubs: Array<(s: ConnState) => void> = [];

export function setConn(s: ConnState): void {
  if (s === conn) return;
  conn = s;
  connSubs.forEach((f) => f(s));
}

export function getConn(): ConnState {
  return conn;
}

export function onConn(f: (s: ConnState) => void): void {
  connSubs.push(f);
  f(conn);
}

export interface LogLine {
  level: 'info' | 'warn';
  msg: string;
  t: number;
}

const LOG_MAX = 200;
const logBuf: LogLine[] = [];
const logSubs: Array<(l: LogLine) => void> = [];

export function pushLog(level: 'info' | 'warn', args: unknown[]): void {
  const msg = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
  const line: LogLine = { level, msg, t: Date.now() };
  logBuf.push(line);
  if (logBuf.length > LOG_MAX) logBuf.shift();
  logSubs.forEach((f) => f(line));
}

export function getLogs(): readonly LogLine[] {
  return logBuf;
}

export function onLog(f: (l: LogLine) => void): void {
  logSubs.push(f);
}

function safeStringify(a: unknown): string {
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
