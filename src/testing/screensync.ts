import { log, warn } from '../core/helpers';
import { loadRrweb } from '../shared/rrweb-loader';
import { fbPut, fbDelete, fbListen } from '../shared/firebase';
import { getDeviceId } from './remote';
import { startLogStream, stopLogStream } from './logsync';

let stopRecordFn: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let syncSource: EventSource | null = null;
let starting = false;

// Rolling buffer holds events since the last full snapshot (checkout), so a
// viewer joining at any time can rebuild the page from a self-contained window.
let buffer: any[] = [];
let bufferId = 0;
let dirty = false;

const SELF_UI = '#autobot-fab, #autobot-panel, #autobot-minibar, #autobot-text-picker, #autobot-assert-popup';

async function startSync(fps = 1): Promise<void> {
  if (stopRecordFn || starting) return;
  starting = true;
  try {
    const rrweb = await loadRrweb(); // lazy: only fetched when sync is turned on
    if (stopRecordFn) return; // sync was stopped while the CDN script loaded

    buffer = [];
    bufferId = Date.now();
    dirty = false;

    const stop = rrweb.record({
      emit(event: any, isCheckout?: boolean) {
        // On checkout rrweb emits a fresh Meta+FullSnapshot — start a new window.
        if (isCheckout) { buffer = []; bufferId = Date.now(); }
        buffer.push(event);
        dirty = true;
      },
      checkoutEveryNms: 10000,
      blockSelector: SELF_UI,
      recordCanvas: false,
      collectFonts: false,
      inlineStylesheet: true, // inline CSS rules → no cross-origin canvas taint
      sampling: { mousemove: 200, scroll: 200, input: 'last' },
    });
    stopRecordFn = stop ?? null;

    const interval = Math.max(500, Math.round(1000 / fps));
    flushTimer = setInterval(flush, interval);
    log('Screen sync started (rrweb, lazy-loaded)');
  } catch (e) {
    warn('Screen sync: rrweb load failed', e);
  } finally {
    starting = false;
  }
}

async function flush(): Promise<void> {
  if (!dirty || buffer.length === 0) return;
  dirty = false;
  const deviceId = getDeviceId();
  await fbPut(`screens/${deviceId}`, {
    kind: 'rrweb',
    bufferId,
    // Serialize events to a single string: rrweb's DOM-tree snapshots nest far
    // deeper than Firebase RTDB's 32-level limit and can contain keys with
    // chars RTDB forbids (. $ # [ ] /), both of which make a raw write 400.
    events: JSON.stringify(buffer),
    url: location.pathname + location.search,
    title: document.title,
    width: window.innerWidth,
    height: window.innerHeight,
    timestamp: Date.now(),
  });
}

function stopSync(): void {
  if (stopRecordFn) { stopRecordFn(); stopRecordFn = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  buffer = [];
  dirty = false;
  const deviceId = getDeviceId();
  fbDelete(`screens/${deviceId}`);
  log('Screen sync stopped');
}

export function listenSyncControl(): void {
  const deviceId = getDeviceId();
  if (syncSource) syncSource.close();

  syncSource = fbListen(`syncControl/${deviceId}`, async () => {
    try {
      const resp = await fetch(`https://autobot-remote-default-rtdb.firebaseio.com/syncControl/${deviceId}.json`);
      const data = await resp.json();
      // Logs stream whenever a viewer is attached (screen sync or logs alone).
      if (data?.screenSync || data?.logSync) {
        startLogStream(data.fps || 1);
      } else {
        stopLogStream();
      }
      if (data?.screenSync) {
        startSync(data.fps || 1);
      } else {
        stopSync();
      }
    } catch {}
  });
}

export function cleanupSync(): void {
  stopSync();
  stopLogStream();
  if (syncSource) { syncSource.close(); syncSource = null; }
}
