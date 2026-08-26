// Realtime facade. Everything in the app talks to the backend through these fb*
// functions; the actual transport is a pluggable Backend (firebase / relay /
// cloudbase) chosen by the injection config — see ./backend. The fb* names are
// kept for history (this layer used to be Firebase RTDB); callers don't move.
//
// This layer owns resilience: ops never throw into UI code (get -> null, writes
// swallow + warn), with one retry on a transient network error.

import { selectBackend } from './backend';
import type { Backend, FbSub } from './backend/types';

export type { FbSub } from './backend/types';

let active: Backend | null = null;
function be(): Backend { return (active ??= selectBackend()); }

function isNetErr(e: any): boolean {
  return /network request error|failed to fetch|network error/i.test((e && e.message) || '');
}
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (isNetErr(e)) return await fn(); throw e; }
}
function warn(where: string, e: any) {
  try { console.warn('[fb]', where, (e && e.message) || e); } catch {}
}

export async function fbGet<T>(path: string): Promise<T | null> {
  try { return await withRetry(() => be().get<T>(path)); } catch { return null; }
}
export async function fbPut(path: string, data: any): Promise<void> {
  try { await withRetry(() => be().put(path, data)); } catch (e) { warn('fbPut ' + path, e); }
}
export async function fbPatch(path: string, data: any): Promise<void> {
  try { await withRetry(() => be().patch(path, data)); } catch (e) { warn('fbPatch ' + path, e); }
}
export async function fbDelete(path: string): Promise<void> {
  try { await withRetry(() => be().delete(path)); } catch (e) { warn('fbDelete ' + path, e); }
}
export function fbListen(path: string, onEvent: (data: any) => void): FbSub {
  try { return be().listen(path, onEvent); }
  catch (e) { warn('fbListen ' + path, e); return { close() {} }; }
}

// networksync skips the agent's own backend traffic so it isn't captured as if it
// were the app's network activity.
export function isOwnTraffic(url: string): boolean {
  try { return be().ownsUrl(url); } catch { return false; }
}

export interface DeviceInfo {
  deviceId: string;
  project: string | null;
  status: 'online' | 'offline';
  lastSeen: number;
  userAgent: string;
  label?: string;   // user-given name (device-owned, editable from the panel)
  title?: string;   // current page title, so you can tell devices apart
}

export interface RemoteCommand {
  id: string;
  targets: string[];
  action: 'run' | 'abort' | 'stage';
  project: string;
  suite: string;
  suiteData?: any;
  stageIndex?: number;  // for action:'stage', -1 = run all
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  createdBy?: string;
  createdAt: number;
  result?: any;
}

export interface CommandProgress {
  status: 'running' | 'completed' | 'failed' | 'aborted';
  progress?: { current: number; total: number; currentCase: string };
  summary?: { total: number; passed: number; failed: number; skipped: number };
  duration?: number;
  report?: any;
  updatedAt: number;
}
