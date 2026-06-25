// Remote inspection of the page's localStorage / sessionStorage. Mirrors
// logsync: a snapshot is pushed to Firebase only while a dashboard has sync
// enabled for this device. Keys/values are sent as a JSON-encoded array of
// [key, value] pairs (NOT as nested RTDB keys — storage keys may contain
// '.', '#', '$', '/', '[', ']', all forbidden in RTDB paths).

import { fbPut, fbDelete } from '../shared/firebase';
import { getDeviceId } from './remote';

const MAX_KEYS = 200;
const MAX_VALUE_LEN = 4000;

let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastHash = '';

function readStore(store: Storage): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const n = Math.min(store.length, MAX_KEYS);
  for (let i = 0; i < n; i++) {
    const k = store.key(i);
    if (k == null) continue;
    let v = store.getItem(k) ?? '';
    if (v.length > MAX_VALUE_LEN) v = v.slice(0, MAX_VALUE_LEN) + `…(+${v.length - MAX_VALUE_LEN})`;
    out.push([k, v]);
  }
  return out;
}

async function flush(): Promise<void> {
  let local: Array<[string, string]> = [];
  let session: Array<[string, string]> = [];
  try { local = readStore(localStorage); } catch {}
  try { session = readStore(sessionStorage); } catch {}

  const localStr = JSON.stringify(local);
  const sessionStr = JSON.stringify(session);
  const hash = localStr.length + ':' + sessionStr.length + ':' + (local[0]?.[1] || '');
  // Cheap change check so we don't rewrite an unchanged snapshot every tick.
  if (hash === lastHash) return;
  lastHash = hash;

  const deviceId = getDeviceId();
  await fbPut(`storage/${deviceId}`, {
    local: localStr,
    session: sessionStr,
    origin: location.origin,
    updatedAt: Date.now(),
  });
}

export function startStorageStream(fps = 1): void {
  if (flushTimer) return;
  lastHash = ''; // force an immediate first push
  const interval = Math.max(1000, Math.round(1000 / fps));
  flushTimer = setInterval(flush, interval);
  flush();
}

export function stopStorageStream(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  lastHash = '';
  const deviceId = getDeviceId();
  fbDelete(`storage/${deviceId}`);
}
